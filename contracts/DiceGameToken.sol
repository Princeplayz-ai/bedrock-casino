// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title DiceGameToken
 * @notice ERC20 token-based Dice game using Chainlink VRF v2 for randomness.
 * Players approve the contract to pull tokens, then call playDiceToken.
 * For testing convenience there's a settleBetManual function restricted to owner
 * that lets us simulate VRF responses in local unit tests.
 *
 * WARNING: This is a demo. Do NOT use in production without audits and compliance.
 */
contract DiceGameToken is VRFConsumerBaseV2, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    VRFCoordinatorV2Interface COORDINATOR;

    // Chainlink VRF params (set on deploy)
    bytes32 public keyHash;
    uint64 public subscriptionId;
    uint16 public requestConfirmations = 3;
    uint32 public callbackGasLimit = 200000;
    uint32 public numWords = 1;

    IERC20 public token;

    uint8 public houseEdgePercent = 2; // 2%
    uint256 public minBet = 1e15; // token smallest units (e.g., 0.001 tokens if 18 decimals)
    uint256 public maxBet = 1e18; // token units

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
    event TokenChanged(address token);

    constructor(
        address vrfCoordinator,
        bytes32 _keyHash,
        uint64 _subscriptionId,
        address _token
    ) VRFConsumerBaseV2(vrfCoordinator) {
        COORDINATOR = VRFCoordinatorV2Interface(vrfCoordinator);
        keyHash = _keyHash;
        subscriptionId = _subscriptionId;
        token = IERC20(_token);
    }

    // owner can update token (useful for tests)
    function setToken(address _token) external onlyOwner {
        token = IERC20(_token);
        emit TokenChanged(_token);
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

    // owner can fund tokens to contract by transferring tokens directly to contract address
    function withdrawToken(uint256 amount, address to) external onlyOwner nonReentrant {
        token.safeTransfer(to, amount);
    }

    // Player plays by approving the contract and then calling this function with amount
    function playDiceToken(uint8 chance, uint256 amount) external nonReentrant returns (uint256 requestId) {
        require(chance >= 1 && chance <= 98, "chance out of range");
        require(amount >= minBet && amount <= maxBet, "bet size out of range");

        // compute potential payout and ensure contract has enough token liquidity
        uint256 potentialPayout = _computePayout(amount, chance);
        require(tokenBalance() >= potentialPayout, "Contract liquidity insufficient");

        // pull tokens from player (requires prior approve)
        token.safeTransferFrom(msg.sender, address(this), amount);

        // request randomness (on testnets, subscription/configuration needed)
        requestId = COORDINATOR.requestRandomWords(
            keyHash,
            subscriptionId,
            requestConfirmations,
            callbackGasLimit,
            numWords
        );

        bets[requestId] = Bet({
            player: msg.sender,
            amount: amount,
            chance: chance,
            settled: false,
            random: 0,
            won: false,
            payout: 0
        });

        emit BetPlaced(requestId, msg.sender, amount, chance);
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
            if (tokenBalance() >= payout) {
                token.safeTransfer(b.player, payout);
            } else {
                payout = 0;
            }
        }

        b.settled = true;
        b.random = rnd;
        b.won = won;
        b.payout = payout;

        emit BetSettled(requestId, b.player, rnd, won, payout);
    }

    // Testing helper: allow owner to settle with a provided random value (for unit tests only)
    function settleBetManual(uint256 requestId, uint256 random) external onlyOwner {
        Bet storage b = bets[requestId];
        require(b.player != address(0), "Bet not found");
        require(!b.settled, "Already settled");

        uint256 rnd = random;
        uint256 roll = (rnd % 100) + 1;
        bool won = roll <= b.chance;

        uint256 payout = 0;
        if (won) {
            payout = _computePayout(b.amount, b.chance);
            if (tokenBalance() >= payout) {
                token.safeTransfer(b.player, payout);
            } else {
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
        uint256 numerator = amount * (100 - houseEdgePercent);
        return numerator / uint256(chance);
    }

    function tokenBalance() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function getBet(uint256 requestId) external view returns (Bet memory) {
        return bets[requestId];
    }
}
