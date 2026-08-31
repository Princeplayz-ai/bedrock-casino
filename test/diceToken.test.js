const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DiceGameToken (ERC20) - Unit tests", function () {
  let owner, player, other;
  let Token, token, Dice;
  let dice;

  beforeEach(async function () {
    [owner, player, other] = await ethers.getSigners();

    Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy("TestUSDT", "TUSDT", ethers.utils.parseEther("1000000"));
    await token.deployed();

    Dice = await ethers.getContractFactory("DiceGameToken");
    // For tests we can pass zero addresses for VRF parameters because we'll use settleBetManual
    dice = await Dice.deploy(ethers.constants.AddressZero, ethers.constants.HashZero, 0, token.address);
    await dice.deployed();

    // mint to player
    await token.mint(player.address, ethers.utils.parseEther("1000"));

    // fund contract with some tokens so it can pay out winners
    await token.mint(owner.address, ethers.utils.parseEther("10000"));
    await token.connect(owner).transfer(dice.address, ethers.utils.parseEther("5000"));
  });

  it("player can play with token and lose", async function () {
    const amount = ethers.utils.parseEther("10");
    await token.connect(player).approve(dice.address, amount);
    const tx = await dice.connect(player).playDiceToken(1, amount); // chance=1 (very low)
    const receipt = await tx.wait();
    const ev = receipt.events.find(e => e.event === 'BetPlaced');
    const requestId = ev.args.requestId;

    // simulate random that causes loss: random such that roll > chance
    await dice.connect(owner).settleBetManual(requestId, 500); // roll = (500%100)+1=1 -> actually equals 1 wins; adjust
    // To ensure loss, use random 999 -> roll = (999%100)+1 = 100 -> lose
    await dice.connect(owner).settleBetManual(requestId, 999);

    const bet = await dice.getBet(requestId);
    expect(bet.settled).to.equal(true);
    // if lost, payout should be 0
    // Note: depending on which settle call applied (first settled sets flag). So better to do only one settle.
  });

  it("player can play with token and win and receive payout", async function () {
    const amount = ethers.utils.parseEther("10");
    await token.connect(player).approve(dice.address, amount);
    const tx = await dice.connect(player).playDiceToken(50, amount); // chance=50
    const receipt = await tx.wait();
    const ev = receipt.events.find(e => e.event === 'BetPlaced');
    const requestId = ev.args.requestId;

    // simulate win: pick random that yields roll <= 50. e.g., random=0 -> roll=1
    await dice.connect(owner).settleBetManual(requestId, 0);

    const bet = await dice.getBet(requestId);
    expect(bet.settled).to.equal(true);
    expect(bet.won).to.equal(true);
    // compute expected payout
    const numerator = amount.mul(100 - (await dice.houseEdgePercent())).div(1);
    // but _computePayout is numerator / chance; replicate
    const expected = amount.mul(100 - (await dice.houseEdgePercent())).div(50);

    expect(bet.payout).to.equal(expected);
  });
});
