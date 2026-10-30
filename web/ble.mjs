// Nordic UART Service UUIDs. Newline JSON is unchanged; BLE packets are just byte fragments.
export const nus = {
  service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  rx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  tx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
};
export async function openBle(onData, onLost) {
  if (!navigator.bluetooth) throw new Error('Web Bluetooth is unavailable. Use a browser with Web Bluetooth support or Electron.');
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [nus.service] }] });
  const decoder = new TextDecoder();
  const lost = () => onLost(new Error('BLE connection lost; output state is unknown.'));
  device.addEventListener('gattserverdisconnected', lost);
  let tx, received;
  try {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(nus.service);
    const rx = await service.getCharacteristic(nus.rx);
    tx = await service.getCharacteristic(nus.tx);
    received = event => onData(decoder.decode(event.target.value, { stream: true }));
    tx.addEventListener('characteristicvaluechanged', received);
    await tx.startNotifications();
    let queue = Promise.resolve();
    return {
      name: device.name || 'RC-Limiter-C3',
      write(bytes) {
        const job = queue.then(async () => {
          for (let offset = 0; offset < bytes.length; offset += 20) {
            await rx.writeValueWithResponse(bytes.slice(offset, offset + 20));
          }
        });
        queue = job.catch(() => {}); return job;
      },
      close() {
        device.removeEventListener('gattserverdisconnected', lost);
        tx.removeEventListener('characteristicvaluechanged', received);
        if (device.gatt.connected) device.gatt.disconnect();
      },
    };
  } catch (error) {
    device.removeEventListener('gattserverdisconnected', lost);
    if (tx && received) tx.removeEventListener('characteristicvaluechanged', received);
    if (device.gatt.connected) device.gatt.disconnect();
    throw error;
  }
}
