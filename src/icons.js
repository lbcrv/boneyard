// Tool pictograms. One stroke weight, square caps, 24px grid: read like
// signage on a test-lab wall, not like a chat app.
const wrap = (body) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  // crane claw
  grab: wrap('<path d="M12 2v5"/><path d="M5 7h14"/><path d="M6 7v6l3.5 4.5"/><path d="M18 7v6l-3.5 4.5"/>'),
  // round shot with speed lines
  cannon: wrap('<circle cx="15.5" cy="12" r="5" fill="currentColor" stroke="none"/><path d="M2 8h6M3 12h5M2 16h6"/>'),
  // charge with a curled fuse and spark
  bomb: wrap('<circle cx="10" cy="15" r="6.5" fill="currentColor" stroke="none"/><path d="M10 8.5V6"/><path d="M10 6c0-2.5 3.5-3 5-1.5"/><path d="M18.5 1.5v2M21.5 4.5h-2M20.8 2.2l-1.3 1.3" stroke-width="1.6"/>'),
  // planked crate
  crate: wrap('<rect x="3.5" y="4.5" width="17" height="15"/><path d="M3.5 9.5h17M3.5 14.5h17"/><path d="M8 4.5v15"/>'),
  // drum with hoops
  barrel: wrap('<rect x="6" y="2.5" width="12" height="19"/><path d="M6 8h12M6 16h12"/>'),
  // box truck
  truck: wrap('<path d="M2 6h12v10H2z"/><path d="M14 10h4l3 3.5V16h-7"/><circle cx="6" cy="18" r="2" fill="currentColor"/><circle cx="17" cy="18" r="2" fill="currentColor"/>'),
  // compact SMG: receiver, stock, magazine, barrel
  smg: wrap('<path d="M3 9h13v4H3z"/><path d="M16 10h5"/><path d="M8 13v6h3v-6"/><path d="M3 9L2 14"/>'),
  // shoulder tube with a rocket head
  bazooka: wrap('<path d="M2 11h15v3H2z"/><path d="M17 10.5l4 2-4 2"/><path d="M7 14v4h2v-4"/>'),
  // trefoil
  nuke: wrap('<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M12 9.5L9.2 4.6a8 8 0 0 1 5.6 0z" fill="currentColor" stroke="none"/><path d="M14.2 13.3l5.6 0a8 8 0 0 1-2.8 4.8z" fill="currentColor" stroke="none"/><path d="M9.8 13.3l-2.8 4.8a8 8 0 0 1-2.8-4.8z" fill="currentColor" stroke="none"/>'),
  // pressure mine: dome on a disc
  mine: wrap('<path d="M3 17h18"/><path d="M5 17a7 5 0 0 1 14 0"/><path d="M12 9.5V7"/><circle cx="12" cy="6" r="1" fill="currentColor"/>'),
  // shock wave
  push: wrap('<path d="M2 12h7"/><path d="M12 6.5a7.5 7.5 0 0 1 0 11"/><path d="M16 3.5a12 12 0 0 1 0 17"/><path d="M20 1.5a16 16 0 0 1 0 21"/>'),
};
