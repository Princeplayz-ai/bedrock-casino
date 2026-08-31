// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CoinFlip
 * @notice Simple 50/50 coin flip game using Chainlink VRF v2. Supports native and ERC20 bets.
 */
contract CoinFlip is VRFConsumerBaseV2, Ownable, ReentrancyGuard {
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

    struct Bet {
        address player;
        address token; // address(0) for native
        uint256 amount;
        uint8 choice; // 0 or 1
        bool settled;
        uint256 random;
        bool won;
        uint256 payout;
    }

    mapping(uint256 => Bet) public bets; // requestId => Bet

    event CoinFlipPlaced(uint256 indexed requestId, address indexed player, address token, uint256 amount, uint8 choice);
    event CoinFlipSettled(uint256 indexed requestId, address indexed player, address token, uint256 random, bool won, uint256 payout);

    constructor(address vrfCoordinator, bytes32 _keyHash, uint64 _subscriptionId) VRFConsumerBaseV2(vrfCoordinator) {
        COORDINATOR = VRFCoordinatorV2Interface(vrfCoordinator);
        keyHash = _keyHash;
        subscriptionId = _subscriptionId;
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

    // Place a coin flip bet. choice: 0 or 1
    function playCoinFlip(address token, uint8 choice, uint256 amount) external payable nonReentrant returns (uint256 requestId) {
        require(choice == 0 || choice == 1, "choice must be 0 or 1");

        if (token == address(0)) {
            require(msg.value == amount, "Native amount mismatch");
            require(amount >= minNativeBet && amount <= maxNativeBet, "bet size out of range");
            uint256 potentialPayout = _computePayout(amount, 50); // 50% chance
            require(address(this).balance >= potentialPayout, "Contract liquidity insufficient");
        } else {
            TokenConfig memory cfg = tokenConfigs[token];
            require(cfg.allowed, "Token not allowed");
            require(amount >= cfg.minBet && amount <= cfg.maxBet, "token bet size out of range");
            IERC20 t = IERC20(token);
            uint256 bal = t.balanceOf(address(this));
            uint256 potentialPayout = _computePayout(amount, 50);
            require(bal >= potentialPayout, "Contract token liquidity insufficient");
            t.safeTransferFrom(msg.sender, address(this), amount);
        }

        requestId = COORDINATOR.requestRandomWords(keyHash, subscriptionId, requestConfirmations, callbackGasLimit, numWords);

        bets[requestId] = Bet({player: msg.sender, token: token, amount: amount, choice: choice, settled: false, random: 0, won: false, payout: 0});

        emit CoinFlipPlaced(requestId, msg.sender, token, amount, choice);
    }

    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
        Bet storage b = bets[requestId];
        require(b.player != address(0), "Bet not found");
        require(!b.settled, "Already settled");

        uint256 rnd = randomWords[0];
        uint8 outcome = uint8(rnd % 2); // 0 or 1
        bool won = (outcome == b.choice);

        uint256 payout = 0;
        if (won) {
            payout = _computePayout(b.amount, 50);
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

        emit CoinFlipSettled(requestId, b.player, b.token, rnd, won, payout);
    }

    function _computePayout(uint256 amount, uint8 chance) internal view returns (uint256) {
        uint256 numerator = amount * (100 - houseEdgePercent);
        return numerator / uint256(chance);
    }

    function getBet(uint256 requestId) external view returns (Bet memory) {
        return bets[requestId];
    }
}
