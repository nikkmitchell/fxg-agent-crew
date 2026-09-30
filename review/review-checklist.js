// Small, optional review UI. No storage, network, scene updates or extra room seats.
const profiles = {
  sky: ['360 sky clearing', [
    'Walk in and out: the whole sky fades smoothly and stays hidden away from the clearing.',
    'Look above, below and behind: the sky surrounds you comfortably.',
    'Summon a shooting star and bolide: both keep travelling through a brighter peak and burn out smoothly.',
    'Walk and snap-turn in VR: movement stays smooth; reduced motion feels comfortable.',
  ]],
  rain: ['Rain retreat', [
    'Approach and leave: rain and sound arrive and fade smoothly.',
    'The raised, mostly flat stone feels welcoming; side moss, companion stones and wet grass feel natural.',
    'Rain is visible in front of the stone; its body hides only drops that fall behind it.',
    'Droplets reach the ground with gentle, readable splashes.',
    'Listen still for a minute: the rain varies gently without an obvious repeating loop.',
    'Try Quiet and reduced motion: sound stops and the rain holds still comfortably.',
    'With another person, enter as yourselves: each sees the other and walking stays smooth.',
  ]],
  sakura: ['Sakura pocket', [
    'Approach and leave: blossom, petals and sound reveal and fade smoothly.',
    'Petals drift naturally without an obvious synchronized pattern.',
    'The separate pocket feels calm at headset scale, including when looking up.',
    'Listen, then Quiet: the subtle breeze feels right and stops when asked.',
    'Walking, snap-turning and reduced motion remain comfortable.',
  ]],
  fireflies: ['Firefly clearing', [
    'Approach and leave: lights and sound reveal and fade smoothly.',
    'Lights wander and pulse independently, without harsh flashes.',
    'The clearing feels immersive at headset scale, without glare or visual clutter.',
    'Listen, then Quiet: faint night sounds feel varied and stop when asked.',
    'Walking, snap-turning and reduced motion remain comfortable.',
  ]],
  bowl: ['Singing bowl', [
    'Strike by pointing, controller contact and fingertip: each produces one clean tone.',
    'Circle the rim slowly: the bowl sustains a tone; a still hand does not keep playing.',
    'Stop rubbing: the tone settles gently; a strike rings for at least six seconds.',
    'Quiet silences the bowl; enabling sound again works.',
    'Two people, both with sound enabled: each hears the other playing, without an echo.',
    'The tone, reach and bowl scale feel comfortable in a headset.',
  ]],
};
const profile = profiles[document.documentElement.dataset.review];
if (profile) mountReview(...profile);

function mountReview(title, checks) {
  const style = document.createElement('style');
  style.textContent = `
    #review-launch{position:fixed;right:16px;top:16px;z-index:20;padding:9px 14px;border:1px solid #60727a;border-radius:20px;background:#16232bea;color:#e1e8e5;font:14px system-ui;cursor:pointer}
    #human-review{box-sizing:border-box;width:min(620px,calc(100vw - 24px));max-height:90vh;overflow:auto;padding:24px;background:#142127;color:#e1e8e5;border:1px solid #536971;border-radius:16px;font:14px/1.5 system-ui}
    #human-review::backdrop{background:#02090bcc}
    #human-review h2{font-size:22px;font-weight:500;margin:0 0 8px}#human-review p{color:#b7c7c9;margin:8px 0 16px}
    #human-review label{display:block;margin:14px 0}#human-review select,#human-review input,#human-review textarea{box-sizing:border-box;display:block;width:100%;margin-top:6px;padding:9px;border:1px solid #556970;border-radius:7px;background:#0b171c;color:#e1e8e5;font:inherit}
    #human-review select{width:auto;max-width:100%}#human-review textarea{resize:vertical}#human-review button,#human-review a{font:inherit;color:#e1e8e5}#human-review button{padding:8px 12px;margin:0 8px 8px 0;background:#263b40;border:1px solid #607c80;border-radius:7px;cursor:pointer}#human-review .close{float:right}#human-review :focus-visible,#review-launch:focus-visible{outline:2px solid #aed0c0;outline-offset:3px}
  `;
  document.head.append(style);
  const launch = document.createElement('button');
  launch.id = 'review-launch'; launch.textContent = 'Review checklist';
  const dialog = document.createElement('dialog'); dialog.id = 'human-review';
  dialog.setAttribute('aria-labelledby', 'review-title');
  // Only fixed markup enters innerHTML. Reviewer text always uses value/textContent.
  dialog.innerHTML = '<button type="button" class="close">Close</button><h2 id="review-title"></h2><p>Check any part you like. Leave the rest untested. Use this before or after VR.</p><form><label>Your name (optional)<input name="reviewer" maxlength="80" autocomplete="off"></label><label>Headset / browser (optional)<input name="device" maxlength="160" autocomplete="off" placeholder="e.g. Quest 2, browser 150.1"></label><div id="review-checks"></div><label>What felt good? What needs work?<textarea name="notes" rows="3" maxlength="3000" placeholder="Describe where it happened and how to repeat it."></textarea></label><button type="submit">Prepare feedback</button></form><section id="review-output" hidden><label>Report to share<textarea id="review-report" rows="8" readonly></textarea></label><button type="button" id="review-copy">Copy report</button><a href="https://webharness.chat/" target="_blank" rel="noopener">Open team chat</a><p id="review-copy-status" role="status">Paste this report in saha.ing chat for Mica and the team.</p></section><p>Your draft stays only on this page. It is not sent or saved automatically; copy it before closing or reloading the page.</p>';
  dialog.querySelector('h2').textContent = title;
  const container = dialog.querySelector('#review-checks');
  const selects = checks.map((text, i) => {
    const label = document.createElement('label'); label.textContent = `${i + 1}. ${text}`;
    const select = document.createElement('select'); select.name = `check-${i}`;
    for (const value of ['Not tested', 'Passed', 'Needs work']) {
      const option = document.createElement('option'); option.value = value; option.textContent = value; select.append(option);
    }
    label.append(select); container.append(label); return select;
  });
  document.body.append(launch, dialog);
  launch.onclick = () => dialog.showModal();
  dialog.querySelector('.close').onclick = () => dialog.close();
  // Keep walking/drag controls from reacting while filling out the review.
  for (const type of ['keydown', 'keyup', 'pointerdown', 'pointermove', 'pointerup', 'wheel']) {
    dialog.addEventListener(type, event => event.stopPropagation());
  }
  const form = dialog.querySelector('form');
  const report = dialog.querySelector('#review-report');
  form.onsubmit = event => {
    event.preventDefault();
    const path = `${location.origin === 'null' ? 'https://saha.ing' : location.origin}${location.pathname}${location.search}`;
    // No fragment: a /go entry may have carried an identity ticket there.
    report.value = [
      `${title} review`, path,
      `Reviewer: ${form.elements.reviewer.value.trim() || 'Not specified'}`,
      `Device: ${form.elements.device.value.trim() || 'Not specified'}`,
      ...checks.map((text, i) => `${selects[i].value}: ${text}`),
      `Notes: ${form.elements.notes.value.trim() || 'None added'}`,
    ].join('\n');
    dialog.querySelector('#review-output').hidden = false;
    dialog.querySelector('#review-copy-status').textContent = 'Paste this report in saha.ing chat for Mica and the team.';
  };
  dialog.querySelector('#review-copy').onclick = async () => {
    const status = dialog.querySelector('#review-copy-status');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(report.value);
      status.textContent = 'Copied. Paste it in saha.ing chat to share it.';
    } catch {
      report.focus(); report.select();
      status.textContent = 'Report selected. Copy with Ctrl+C, or your browser selection menu, then paste in saha.ing chat.';
    }
  };
}
