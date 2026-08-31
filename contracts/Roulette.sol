// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Roulette
 * @notice Simple roulette game supporting number (0-36), color (red/black), and odd/even bets.
 * Uses Chainlink VRF v2 for randomness. Supports native and ERC20 bets.
 */
contract Roulette is VRFConsumerBaseV2, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    VRFCoordinatorV2Interface COORDINATOR;

    bytes32 public keyHash;
    uint64 public subscriptionId;
    uint16 public requestConfirmations = 3;
    uint32 public callbackGasLimit = 200000;
    uint32 public numWords = 1;

    uint8 public houseEdgePercent = 2; // 2%

    uint256 public minNativeBet = 0.001 ether;
    uint256 public maxNativeBet = 1 ether;

    struct TokenConfig {
        bool allowed;
        uint256 minBet;
        uint256 maxBet;
        uint8 decimals;
    }

    mapping(address => TokenConfig) public tokenConfigs;

    enum BetType { Number, Color, OddEven }

    struct Bet {
        address player;
        address token; // address(0) for native
        uint256 amount;
        BetType betType;
        uint8 value; // number 0-36, color 0=red 1=black, oddeven 0=even 1=odd
        bool settled;
        uint256 random;
        bool won;
        uint256 payout;
    }

    mapping(uint256 => Bet) public bets; // requestId => Bet

    event RoulettePlaced(uint256 indexed requestId, address indexed player, address token, uint256 amount, BetType betType, uint8 value);
    event RouletteSettled(uint256 indexed requestId, address indexed player, address token, uint256 random, bool won, uint256 payout);

    // Standard roulette wheel red numbers for European wheel
    uint8[] private redNumbers;

    constructor(address vrfCoordinator, bytes32 _keyHash, uint64 _subscriptionId) VRFConsumerBaseV2(vrfCoordinator) {
        COORDINATOR = VRFCoordinatorV2Interface(vrfCoordinator);
        keyHash = _keyHash;
        subscriptionId = _subscriptionId;
        _initRedNumbers();
    }

    function _initRedNumbers() internal {
        redNumbers = [
            1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36
        ];
    }

    receive() external payable {}

    // Owner functions
    function fund() external payable onlyOwner {}

    function withdrawNative(uint256 amount, address payable to) external onlyOwner nonReentrant {
        require(address(this).balance >= amount, "Insufficient native balance");
        to.transfer(amount);
    }

    function withdrawToken(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        IERC20(token).safeTransfer(to, amount);
    }

    function configureToken(address token, bool allowed, uint256 minBet_, uint256 maxBet_, uint8 decimals_) external onlyOwner {
        tokenConfigs[token] = TokenConfig({allowed: allowed, minBet: minBet_, maxBet: maxBet_, decimals: decimals_});
    }

    function setHouseEdge(uint8 edgePercent) external onlyOwner {
        require(edgePercent <= 10, "Edge too high");
        houseEdgePercent = edgePercent;
    }

    function setMinMaxNativeBet(uint256 minBet_, uint256 maxBet_) external onlyOwner {
        require(minBet_ <= maxBet_, "min>max");
        minNativeBet = minBet_;
        maxNativeBet = maxBet_;
    }

    // Place roulette bet
    function playRoulette(BetType betType, uint8 value, address token, uint256 amount) external payable nonReentrant returns (uint256 requestId) {
        // validate bet params
        if (token == address(0)) {
            require(msg.value == amount, "Native amount mismatch");
            require(amount >= minNativeBet && amount <= maxNativeBet, "bet size out of range");
        } else {
            TokenConfig memory cfg = tokenConfigs[token];
            require(cfg.allowed, "Token not allowed");
            require(amount >= cfg.minBet && amount <= cfg.maxBet, "token bet size out of range");
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        // compute potential payout based on bet type
        uint256 multiplier = _payoutMultiplier(betType);
        uint256 potentialPayout = _computePayout(amount * multiplier, 100); // using compute formula with chance expressed as percent base
        if (token == address(0)) {
            require(address(this).balance >= potentialPayout, "Contract liquidity insufficient");
        } else {
            IERC20 t = IERC20(token);
            uint256 bal = t.balanceOf(address(this));
            require(bal >= potentialPayout, "Contract token liquidity insufficient");
        }

        requestId = COORDINATOR.requestRandomWords(keyHash, subscriptionId, requestConfirmations, callbackGasLimit, numWords);

        // store bet
        bets[requestId] = Bet({player: msg.sender, token: token, amount: amount, betType: betType, value: value, settled: false, random: 0, won: false, payout: 0});

        emit RoulettePlaced(requestId, msg.sender, token, amount, betType, value);
    }

    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
        Bet storage b = bets[requestId];
        require(b.player != address(0), "Bet not found");
        require(!b.settled, "Already settled");

        uint256 rnd = randomWords[0];
        uint8 outcome = uint8(rnd % 37); // 0..36

        bool won = false;
        uint256 payout = 0;

        if (b.betType == BetType.Number) {
            // win if exact number
            if (outcome == b.value) {
                won = true;
                uint256 multiplier = 35; // straight number pays 35x
                payout = _computePayout(b.amount * multiplier, 100);
            }
        } else if (b.betType == BetType.Color) {
            // value: 0=red,1=black; zero is neither (house wins)
            if (outcome != 0) {
                bool isRed = _isRed(outcome);
                if ((b.value == 0 && isRed) || (b.value == 1 && !isRed)) {
                    won = true;
                    uint256 multiplier = 2; // color pays 2x
                    payout = _computePayout(b.amount * multiplier, 100);
                }
            }
        } else if (b.betType == BetType.OddEven) {
            // value: 0=even,1=odd; zero is neither
            if (outcome != 0) {
                bool isOdd = (outcome % 2 == 1);
                if ((b.value == 1 && isOdd) || (b.value == 0 && !isOdd)) {
                    won = true;
                    uint256 multiplier = 2; // even/odd pays 2x
                    payout = _computePayout(b.amount * multiplier, 100);
                }
            }
        }

        if (won) {
            if (b.token == address(0)) {
                if (address(this).balance >= payout) {
                    payable(b.player).transfer(payout);
                } else {
                    payout = 0;
                }
            } else {
                IERC20 t = IERC20(b.token);
                uint256 bal = t.balanceOf(address(this));
                if (bal >= payout) {
                    t.safeTransfer(b.player, payout);
                } else {
                    payout = 0;
                }
            }
        }

        b.settled = true;
        b.random = rnd;
        b.won = won;
        b.payout = payout;

        emit RouletteSettled(requestId, b.player, b.token, rnd, won, payout);
    }

    function _isRed(uint8 number) internal view returns (bool) {
        for (uint i = 0; i < redNumbers.length; i++) {
            if (redNumbers[i] == number) return true;
        }
        return false;
    }

    function _payoutMultiplier(BetType bt) internal pure returns (uint256) {
        if (bt == BetType.Number) return 35; // straight number
        if (bt == BetType.Color) return 2;
        if (bt == BetType.OddEven) return 2;
        return 0;
    }

    // compute payout using house edge; chance param is used as denominator base (100 in this scheme)
    function _computePayout(uint256 scaledAmount, uint8 chanceBase) internal view returns (uint256) {
        uint256 numerator = scaledAmount * (100 - houseEdgePercent);
        return numerator / uint256(chanceBase);
    }

    function getBet(uint256 requestId) external view returns (Bet memory) {
        return bets[requestId];
    }
}
