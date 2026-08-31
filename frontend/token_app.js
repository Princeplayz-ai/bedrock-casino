// Frontend token-based demo script
const CONTRACT_ADDRESS = "REPLACE_WITH_DEPLOYED_TOKEN_DICE_CONTRACT";
const ABI = [
  "function playDiceToken(uint8 chance, uint256 amount) returns (uint256)",
  "function tokenBalance() view returns (uint256)",
  "event BetPlaced(uint256 indexed requestId, address indexed player, uint256 amount, uint8 chance)",
  "event BetSettled(uint256 indexed requestId, address indexed player, uint256 random, bool won, uint256 payout)"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

let provider, signer, contract;
const connectBtn = document.getElementById('connect');
const accountDiv = document.getElementById('account');
const status = document.getElementById('status');
const events = document.getElementById('events');

let tokenContract;

async function connect() {
  if (window.ethereum === undefined) return alert('Install MetaMask');
  provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  signer = provider.getSigner();
  const account = await signer.getAddress();
  accountDiv.textContent = account;
  contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
}

async function approve() {
  const tokenAddr = document.getElementById('tokenAddr').value.trim();
  if (!tokenAddr) return alert('Enter token address to approve');
  tokenContract = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
  const amt = ethers.utils.parseUnits(document.getElementById('betAmount').value.toString(), 18);
  status.textContent = 'Sending approve...';
  try {
    const tx = await tokenContract.approve(CONTRACT_ADDRESS, amt);
    await tx.wait();
    status.textContent = 'Approved';
  } catch (e) {
    console.error(e);
    status.textContent = 'Error approving: ' + e.message;
  }
}

async function placeBet() {
  if (!contract) return alert('Connect first');
  const tokenAddr = document.getElementById('tokenAddr').value.trim();
  if (!tokenAddr) return alert('Enter token address');
  const amt = ethers.utils.parseUnits(document.getElementById('betAmount').value.toString(), 18);
  const chance = Number(document.getElementById('chance').value);
  status.textContent = 'Placing token bet...';
  try {
    const tx = await contract.playDiceToken(chance, amt);
    status.textContent = 'Tx sent: ' + tx.hash;
    await tx.wait();
    status.textContent = 'Tx mined: ' + tx.hash;
  } catch (e) {
    console.error(e);
    status.textContent = 'Error: ' + e.message;
  }
}

connectBtn.addEventListener('click', connect);
document.getElementById('approve').addEventListener('click', approve);
document.getElementById('place').addEventListener('click', placeBet);
