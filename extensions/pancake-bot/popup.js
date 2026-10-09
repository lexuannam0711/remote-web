const slotList = document.getElementById('slots');
const toggle = document.getElementById('toggle');
let enabled = true;
let values = [{ slot: 'bot1' }, { slot: 'bot2' }, { slot: 'manual' }];
function render() {
  toggle.textContent = enabled ? 'Tat bridge' : 'Bat bridge';
  toggle.setAttribute('aria-pressed', String(enabled));
  slotList.replaceChildren(...values.map(({ slot, url }) => {
    const li = document.createElement('li');
    li.textContent = `${slot === 'bot1' ? 'Bot 1' : slot === 'bot2' ? 'Bot 2' : 'Tab 3'}: ${url || 'Chua ket noi'}`;
    return li;
  }));
}
function showError() { document.getElementById('status').textContent = 'Extension khong san sang. Hay thu lai.'; }
chrome.storage.local.get({ bridgeEnabled: true }).then((settings) => { enabled = settings.bridgeEnabled; render(); }).catch(showError);
chrome.runtime.sendMessage({ type: 'get-slots' }).then((result) => { if (!result.ok) throw new Error('Unavailable'); values = result.slots; render(); }).catch(showError);
toggle.addEventListener('click', async () => {
  try { await chrome.storage.local.set({ bridgeEnabled: !enabled }); enabled = !enabled; render(); }
  catch (_) { showError(); }
});
document.getElementById('open').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'open-pancake-tab' }).then((result) => { if (!result.ok) showError(); }).catch(showError));
chrome.runtime.onMessage.addListener((message) => { if (message?.type === 'slots-changed') { values = message.slots; render(); } });
