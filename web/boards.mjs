let profiles = [];
export async function loadBoardProfiles() {
  const response = await fetch(new URL('./hardware/boards.json', import.meta.url));
  if (!response.ok) throw new Error('Could not load board pin layouts.');
  profiles = await response.json(); return profiles;
}
export function dividerVoltage(input, top = 4700, bottom = 6800) { return input * bottom / (top + bottom); }
export function drawBoard(board, container, selectedInput, selectedOutput) {
  container.replaceChildren();
  const title = document.createElement('p'); title.textContent = `Top/component view · USB at ${board.usb} · verify your board's silkscreen`; title.className = 'hint'; container.append(title);
  const drawing = document.createElement('div'); drawing.className = 'pinboard';
  const usb = document.createElement('div'); usb.className = 'pinboard-usb'; usb.textContent = 'USB';
  if (board.usb === 'top') drawing.append(usb);
  for (let i = 0; i < board.left.length; i++) {
    const row = document.createElement('div'); row.className = 'pin-row';
    for (const side of ['left', 'right']) {
      const label = board[side][i];
      const node = document.createElement('span');
      const match = /^(?:GP|GPIO)(\d+)$/.exec(label); const gpio = match ? Number(match[1]) : undefined;
      node.className = 'pin-label';
      if (gpio !== undefined && board.avoid.includes(gpio)) node.classList.add('pin-reserved');
      else if (gpio !== undefined && board.input_only.includes(gpio)) node.classList.add('pin-input-only');
      if (gpio !== undefined && gpio === selectedInput) node.classList.add('pin-rx');
      if (gpio !== undefined && gpio === selectedOutput) node.classList.add('pin-esc');
      if (['5V', '3V3', 'VBUS', 'VSYS'].includes(label)) node.classList.add('pin-power');
      if (['GND', 'AGND'].includes(label)) node.classList.add('pin-ground');
      node.textContent = `${board[`${side}_positions`][i]} · ${label}`;
      if (side === 'right') { const center = document.createElement('span'); center.className = 'pin-core'; center.textContent = '│'; row.append(center); }
      row.append(node);
    }
    drawing.append(row);
  }
  if (board.usb === 'bottom') drawing.append(usb);
  container.append(drawing);
}
export function boardForFirmware(board, usbInterface) {
  return profiles.find(p => p.id === (board === 'esp32c3' ? (usbInterface === 'usb_uart' ? 'esp32c3-devkit' : 'esp32c3-supermini') : board === 'esp32' ? 'esp32-devkit' : 'pico'));
}
