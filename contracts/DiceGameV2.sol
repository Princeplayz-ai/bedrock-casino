// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title DiceGameV2
 * @notice Extended DiceGame with ERC20 betting support (USDT/USDC/etc.)
 * - Supports native bets (token == address(0)) and ERC20 bets (token != address(0)).
 * - Uses Chainlink VRF v2 for randomness.
 * - Admin can whitelist tokens and set per-token min/max bet (in token smallest unit).
 * NOTE: This is a demonstration. Do NOT use in production without audits and multisig treasury.
 */
contract DiceGameV2 is VRFConsumerBaseV2, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    VRFCoordinatorV2Interface COORDINATOR;

    // VRF params
    bytes32 public keyHash;
    uint64 public subscriptionId;
    uint16 public requestConfirmations = 3;
    uint32 public callbackGasLimit = 200000;
    uint32 public numWords = 1;

    uint8 public houseEdgePercent = 2; // 2%

    // Native bet min/max (wei)
    uint256 public minNativeBet = 0.001 ether;
    uint256 public maxNativeBet = 1 ether;

    struct TokenConfig {
        bool allowed;
        uint256 minBet; // in token smallest unit
        uint256 maxBet;
        uint8 decimals; // token decimals, fallback if 0
    }

    mapping(address => TokenConfig) public tokenConfigs;

    struct Bet {
        address player;
        address token; // address(0) for native
        uint256 amount;
        uint8 chance; // 1..98
        bool settled;
        uint256 random;
        bool won;
        uint256 payout;
    }

    mapping(uint256 => Bet) public bets; // requestId => Bet

    event BetPlaced(uint256 indexed requestId, address indexed player, address token, uint256 amount, uint8 chance);
    event BetSettled(uint256 indexed requestId, address indexed player, address token, uint256 random, bool won, uint256 payout);
    event TokenConfigured(address token, bool allowed, uint256 minBet, uint256 maxBet, uint8 decimals);
    event MinMaxNativeBetChanged(uint256 minNative, uint256 maxNative);
    event HouseEdgeChanged(uint8 newEdge);

    constructor(
        address vrfCoordinator,
        bytes32 _keyHash,
        uint64 _subscriptionId
    ) VRFConsumerBaseV2(vrfCoordinator) {
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

    function setHouseEdge(uint8 edgePercent) external onlyOwner {
        require(edgePercent <= 10, "Edge too high");
        houseEdgePercent = edgePercent;
        emit HouseEdgeChanged(edgePercent);
    }

    function setMinMaxNativeBet(uint256 minBet_, uint256 maxBet_) external onlyOwner {
        require(minBet_ <= maxBet_, "min>max");
        minNativeBet = minBet_;
        maxNativeBet = maxBet_;
        emit MinMaxNativeBetChanged(minBet_, maxBet_);
    }

    function configureToken(address token, bool allowed, uint256 minBet_, uint256 maxBet_, uint8 decimals_) external onlyOwner {
        tokenConfigs[token] = TokenConfig({allowed: allowed, minBet: minBet_, maxBet: maxBet_, decimals: decimals_});
        emit TokenConfigured(token, allowed, minBet_, maxBet_, decimals_);
    }

    // Betting entrypoint. For native bets, send ETH/MATIC with call and token == address(0).
    // For ERC20 bets, token parameter must be set and the caller must have approved this contract for amount.
    function playDice(address token, uint8 chance, uint256 amount) external payable nonReentrant returns (uint256 requestId) {
        require(chance >= 1 && chance <= 98, "chance out of range");

        if (token == address(0)) {
            // native bet: msg.value must equal amount
            require(msg.value == amount, "Native amount mismatch");
            require(amount >= minNativeBet && amount <= maxNativeBet, "bet size out of range");
            // ensure contract can pay max possible payout in native
            uint256 potentialPayout = _computePayout(amount, chance);
            require(address(this).balance >= potentialPayout, "Contract liquidity insufficient");
        } else {
            // token bet
            TokenConfig memory cfg = tokenConfigs[token];
            require(cfg.allowed, "Token not allowed");
            require(amount >= cfg.minBet && amount <= cfg.maxBet, "token bet size out of range");
            // ensure contract token liquidity
            IERC20 t = IERC20(token);
            uint256 bal = t.balanceOf(address(this));
            uint256 potentialPayout = _computePayout(amount, chance);
            require(bal >= potentialPayout, "Contract token liquidity insufficient");
            // transfer tokens from player into contract
            t.safeTransferFrom(msg.sender, address(this), amount);
        }

        // request randomness
        requestId = COORDINATOR.requestRandomWords(
            keyHash,
            subscriptionId,
            requestConfirmations,
            callbackGasLimit,
            numWords
        );

        bets[requestId] = Bet({
            player: msg.sender,
            token: token,
            amount: amount,
            chance: chance,
            settled: false,
            random: 0,
            won: false,
            payout: 0
        });

        emit BetPlaced(requestId, msg.sender, token, amount, chance);
    }

    // Chainlink VRF callback
    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
        Bet storage b = bets[requestId];
        require(b.player != address(0), "Bet not found");
        require(!b.settled, "Already settled");

        uint256 rnd = randomWords[0];
        uint256 roll = (rnd % 100) + 1; // 1..100
        bool won = roll <= b.chance;

        uint256 payout = 0;
        if (won) {
            payout = _computePayout(b.amount, b.chance);
            if (b.token == address(0)) {
                // native payout
                if (address(this).balance >= payout) {
                    payable(b.player).transfer(payout);
                } else {
                    payout = 0; // insufficient funds
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

        emit BetSettled(requestId, b.player, b.token, rnd, won, payout);
    }

    function _computePayout(uint256 amount, uint8 chance) internal view returns (uint256) {
        // payout = amount * (100 - houseEdgePercent) / chance
        uint256 numerator = amount * (100 - houseEdgePercent);
        return numerator / uint256(chance);
    }

    // helpers
    function getBet(uint256 requestId) external view returns (Bet memory) {
        return bets[requestId];
    }
}
