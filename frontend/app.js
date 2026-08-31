// Minimal front-end script to interact with DiceGameV2 contract (supports native and ERC20 bets)
const CONTRACT_ADDRESS = "REPLACE_WITH_DEPLOYED_CONTRACT";

// Example token addresses placeholder - replace per network when deploying
const TOKEN_ADDRESSES = {
  USDT: "0x55d398326f99059fF775485246999027B3197955", // BSC example
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"  // Ethereum example
};

const ABI = [
  "function playDice(address token, uint8 chance, uint256 amount) payable returns (uint256)",
  "function getBet(uint256 requestId) view returns (tuple(address player,address token,uint256 amount,uint8 chance,bool settled,uint256 random,bool won,uint256 payout))",
  "function configureToken(address token, bool allowed, uint256 minBet, uint256 maxBet, uint8 decimals)",
  "event BetPlaced(uint256 indexed requestId, address indexed player, address token, uint256 amount, uint8 chance)",
  "event BetSettled(uint256 indexed requestId, address indexed player, address token, uint256 random, bool won, uint256 payout)"
];

let provider, signer, contract;
const connectBtn = document.getElementById('connect');
const accountDiv = document.getElementById('account');
const status = document.getElementById('status');
const events = document.getElementById('events');

async function connect() {
  if (window.ethereum === undefined) return alert('Install MetaMask');
  provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  signer = provider.getSigner();
  const account = await signer.getAddress();
  accountDiv.textContent = account;
  contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

  // listen
  contract.on('BetPlaced', (requestId, player, token, amount, chance) => {
    const li = document.createElement('li');
    li.textContent = `Placed ${amount.toString()} by ${player} token ${token} chance ${chance} request ${requestId}`;
    events.prepend(li);
  });
  contract.on('BetSettled', (requestId, player, token, random, won, payout) => {
    const li = document.createElement('li');
    li.textContent = `Settled ${requestId} player ${player} token ${token} won:${won} payout:${payout.toString()}`;
    events.prepend(li);
  });
}

async function placeBet() {
  if (!contract) return alert('Connect first');
  const amt = document.getElementById('betAmount').value;
  const chance = Number(document.getElementById('chance').value);
  const tokenSel = document.getElementById('token').value; // 'NATIVE' or address
  if (chance < 1 || chance > 98) return alert('Chance must be 1-98');

  let token = ethers.constants.AddressZero;
  let overrides = {};
  let amount;

  if (tokenSel === 'NATIVE') {
    token = ethers.constants.AddressZero;
    amount = ethers.utils.parseEther(amt.toString());
    overrides = { value: amount };
  } else {
    token = tokenSel; // token address
    // amount in token smallest unit - for demo assume 18 decimals
    amount = ethers.utils.parseUnits(amt.toString(), 18);
    // ensure approval
    const erc20 = new ethers.Contract(token, ["function approve(address spender, uint256 amount) returns (bool)", "function allowance(address owner, address spender) view returns (uint256)"], signer);
    const allowance = await erc20.allowance(await signer.getAddress(), CONTRACT_ADDRESS);
    if (allowance.lt(amount)) {
      status.textContent = 'Requesting approval...';
      const tx = await erc20.approve(CONTRACT_ADDRESS, amount);
      await tx.wait();
    }
  }

  status.textContent = 'Sending transaction...';
  try {
    const tx = await contract.playDice(token, chance, amount, overrides);
    status.textContent = 'Tx sent: ' + tx.hash;
    await tx.wait();
    status.textContent = 'Tx mined: ' + tx.hash;
  } catch (e) {
    console.error(e);
    status.textContent = 'Error: ' + (e.message || e);
  }
}

connectBtn.addEventListener('click', connect);
document.getElementById('place').addEventListener('click', placeBet);
