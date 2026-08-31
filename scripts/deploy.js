// Simple deploy script for Mumbai testnet. Fill .env with PRIVATE_KEY and MUMBAI_RPC
require('dotenv').config();
const hre = require('hardhat');

async function main() {
  const Dice = await hre.ethers.getContractFactory('DiceGame');
  // Replace these with your VRF coordinator, keyHash and subscriptionId for Mumbai
  const vrfCoordinator = process.env.VRF_COORDINATOR || "0x";
  const keyHash = process.env.KEY_HASH || "0x";
  const subscriptionId = process.env.SUBSCRIPTION_ID ? Number(process.env.SUBSCRIPTION_ID) : 0;

  const dice = await Dice.deploy(vrfCoordinator, keyHash, subscriptionId);
  await dice.deployed();
  console.log('DiceGame deployed to:', dice.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
