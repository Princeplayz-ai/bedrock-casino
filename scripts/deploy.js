// Deploy script updated to deploy DiceGameV2, CoinFlip, and Roulette
require('dotenv').config();
const hre = require('hardhat');

async function main() {
  const Dice = await hre.ethers.getContractFactory('DiceGameV2');
  const Coin = await hre.ethers.getContractFactory('CoinFlip');
  const Roulette = await hre.ethers.getContractFactory('Roulette');

  const vrfCoordinator = process.env.VRF_COORDINATOR || "0x";
  const keyHash = process.env.KEY_HASH || "0x";
  const subscriptionId = process.env.SUBSCRIPTION_ID ? Number(process.env.SUBSCRIPTION_ID) : 0;

  const dice = await Dice.deploy(vrfCoordinator, keyHash, subscriptionId);
  await dice.deployed();
  console.log('DiceGameV2 deployed to:', dice.address);

  const coin = await Coin.deploy(vrfCoordinator, keyHash, subscriptionId);
  await coin.deployed();
  console.log('CoinFlip deployed to:', coin.address);

  const roulette = await Roulette.deploy(vrfCoordinator, keyHash, subscriptionId);
  await roulette.deployed();
  console.log('Roulette deployed to:', roulette.address);

  // Optional: configure tokens via env var (JSON string) for each contract
  // Example TOKEN_CONFIG='[{"contract":"dice","address":"0x...","min":1000000,"max":1000000000,"decimals":6},{"contract":"coin","address":"0x...","min":1000000,"max":1000000000,"decimals":6}]'
  if (process.env.TOKEN_CONFIG) {
    try {
      const cfg = JSON.parse(process.env.TOKEN_CONFIG);
      for (const t of cfg) {
        if (t.contract === 'dice') {
          const tx = await dice.configureToken(t.address, true, t.min, t.max, t.decimals);
          await tx.wait();
          console.log('Configured token for dice', t.address);
        } else if (t.contract === 'coin') {
          const tx = await coin.configureToken(t.address, true, t.min, t.max, t.decimals);
          await tx.wait();
          console.log('Configured token for coin', t.address);
        } else if (t.contract === 'roulette') {
          const tx = await roulette.configureToken(t.address, true, t.min, t.max, t.decimals);
          await tx.wait();
          console.log('Configured token for roulette', t.address);
        }
      }
    } catch (e) {
      console.error('Failed to parse TOKEN_CONFIG', e);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
