// Minimal front-end script to interact with DiceGame contract
const CONTRACT_ADDRESS = "REPLACE_WITH_DEPLOYED_CONTRACT";
const ABI = [
  "function playDice(uint8 chance) payable returns (uint256)",
  "event BetPlaced(uint256 indexed requestId, address indexed player, uint256 amount, uint8 chance)",
  "event BetSettled(uint256 indexed requestId, address indexed player, uint256 random, bool won, uint256 payout)"
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
  contract.on('BetPlaced', (requestId, player, amount, chance) => {
    const li = document.createElement('li');
    li.textContent = `Placed ${ethers.utils.formatEther(amount)} by ${player} chance ${chance} request ${requestId}`;
    events.prepend(li);
  });
  contract.on('BetSettled', (requestId, player, random, won, payout) => {
    const li = document.createElement('li');
    li.textContent = `Settled ${requestId} player ${player} won:${won} payout:${ethers.utils.formatEther(payout)}`;
    events.prepend(li);
  });
}

async function placeBet() {
  if (!contract) return alert('Connect first');
  const amt = document.getElementById('betAmount').value;
  const chance = Number(document.getElementById('chance').value);
  if (chance < 1 || chance > 98) return alert('Chance must be 1-98');
  const overrides = { value: ethers.utils.parseEther(amt.toString()) };
  status.textContent = 'Sending transaction...';
  try {
    const tx = await contract.playDice(chance, overrides);
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
