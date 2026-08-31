const hre = require('hardhat');
require('dotenv').config();

async function main() {
  const Token = await hre.ethers.getContractFactory('MockERC20');
  const token = await Token.deploy('TestUSDT','TUSDT', hre.ethers.utils.parseEther('1000000'));
  await token.deployed();
  console.log('Mock token deployed to:', token.address);

  const Dice = await hre.ethers.getContractFactory('DiceGameToken');
  const vrfCoordinator = process.env.VRF_COORDINATOR || hre.ethers.constants.AddressZero;
  const keyHash = process.env.KEY_HASH || hre.ethers.constants.HashZero;
  const subscriptionId = process.env.SUBSCRIPTION_ID ? Number(process.env.SUBSCRIPTION_ID) : 0;

  const dice = await Dice.deploy(vrfCoordinator, keyHash, subscriptionId, token.address);
  await dice.deployed();
  console.log('DiceGameToken deployed to:', dice.address);
}

main().catch((err)=>{console.error(err);process.exit(1);});
