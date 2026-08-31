// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title DiceGame
 * @notice Simple provably-fair dice betting contract using Chainlink VRF v2.
 * - Players bet native token (MATIC) by calling playDice with a chance (1-98).
 * - Contract requests randomness from Chainlink VRF and settles the bet in fulfillRandomWords.
 * - Owner can fund the contract, withdraw, and configure house edge and min/max bets.
 *
 * Security notes:
 * - This is a demo and minimal example. Do NOT use in production without audits.
 * - For production, support ERC20 USDT tokens, KYC/AML, rate limits, oracle confirmations,
 *   insurance treasury, multi-sig for withdrawals, and formal verification.
 */
contract DiceGame is VRFConsumerBaseV2, Ownable, ReentrancyGuard {
    VRFCoordinatorV2Interface COORDINATOR;

    // Chainlink VRF params (set on deploy)
    bytes32 public keyHash;
    uint64 public subscriptionId;
    uint16 public requestConfirmations = 3;
    uint32 public callbackGasLimit = 200000;
    uint32 public numWords = 1;

    uint8 public houseEdgePercent = 2; // 2%
    uint256 public minBet = 0.001 ether;
    uint256 public maxBet = 1 ether;

    struct Bet {
        address player;
        uint256 amount;
        uint8 chance; // 1..98
        bool settled;
        uint256 random;
        bool won;
        uint256 payout;
    }

    mapping(uint256 => Bet) public bets; // requestId => Bet

    event BetPlaced(uint256 indexed requestId, address indexed player, uint256 amount, uint8 chance);
    event BetSettled(uint256 indexed requestId, address indexed player, uint256 random, bool won, uint256 payout);
    event HouseEdgeChanged(uint8 newEdge);
    event MinMaxBetChanged(uint256 minBet_, uint256 maxBet_);

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

    function fund() external payable onlyOwner {}

    function withdraw(uint256 amount, address payable to) external onlyOwner nonReentrant {
        require(address(this).balance >= amount, "Insufficient balance");
        to.transfer(amount);
    }

    function setHouseEdge(uint8 edgePercent) external onlyOwner {
        require(edgePercent <= 10, "Edge too high");
        houseEdgePercent = edgePercent;
        emit HouseEdgeChanged(edgePercent);
    }

    function setMinMaxBet(uint256 minBet_, uint256 maxBet_) external onlyOwner {
        require(minBet_ <= maxBet_, "min>max");
        minBet = minBet_;
        maxBet = maxBet_;
        emit MinMaxBetChanged(minBet_, maxBet_);
    }

    function playDice(uint8 chance) external payable nonReentrant returns (uint256 requestId) {
        require(chance >= 1 && chance <= 98, "chance out of range");
        require(msg.value >= minBet && msg.value <= maxBet, "bet size out of range");
        // ensure contract can pay max possible payout
        uint256 potentialPayout = _computePayout(msg.value, chance);
        require(address(this).balance >= potentialPayout, "Contract liquidity insufficient");

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
            amount: msg.value,
            chance: chance,
            settled: false,
            random: 0,
            won: false,
            payout: 0
        });

        emit BetPlaced(requestId, msg.sender, msg.value, chance);
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
            // safety: ensure balance
            if (address(this).balance >= payout) {
                payable(b.player).transfer(payout);
            } else {
                // in the unlikely event of insufficient balance, mark payout 0 and emit
                payout = 0;
            }
        }

        b.settled = true;
        b.random = rnd;
        b.won = won;
        b.payout = payout;

        emit BetSettled(requestId, b.player, rnd, won, payout);
    }

    function _computePayout(uint256 amount, uint8 chance) internal view returns (uint256) {
        // payout = amount * (100 - houseEdgePercent) / chance
        // example: chance=50, edge=2 -> multiplier = 98/50 = 1.96
        uint256 numerator = amount * (100 - houseEdgePercent);
        return numerator / uint256(chance);
    }

    // helpers for front-end
    function getBet(uint256 requestId) external view returns (Bet memory) {
        return bets[requestId];
    }
}
