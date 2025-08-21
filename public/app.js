(() => {
  const phoneInput = document.getElementById('phone');
  const callBtn = document.getElementById('callBtn');
  const statusEl = document.getElementById('status');

  function setStatus(text) {
    statusEl.textContent = text || '';
  }

  async function startCall() {
    const phoneNumber = (phoneInput.value || '').trim();
    if (!phoneNumber) {
      setStatus('Please enter a destination phone number.');
      return;
    }
    callBtn.disabled = true;
    setStatus('Placing call...');
    try {
      const res = await fetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Request failed');
      setStatus(`Call initiated. Call SID: ${data.callSid}`);
    } catch (err) {
      setStatus(`Failed to initiate call: ${err.message || err}`);
    } finally {
      callBtn.disabled = false;
    }
  }

  callBtn.addEventListener('click', startCall);
})();


