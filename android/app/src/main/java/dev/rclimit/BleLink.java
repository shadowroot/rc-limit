package dev.rclimit;

import android.bluetooth.*;
import android.content.Context;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** Native GATT implementation of the Nordic UART Service, with acknowledged 20-byte writes. */
final class BleLink implements MainActivity.Link {
    static final UUID SERVICE=UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID RX=UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID TX=UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID CCCD=UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private final BlockingQueue<byte[]> received=new ArrayBlockingQueue<>(256);
    private final CountDownLatch ready=new CountDownLatch(1);
    private volatile CountDownLatch writeAck;
    private volatile IOException failure;
    private volatile boolean closed=false;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic rx;
    private byte[] current;
    private int offset;
    BleLink(Context context,BluetoothDevice device) throws IOException {
        gatt=device.connectGatt(context,false,callbacks,BluetoothDevice.TRANSPORT_LE);
        if(gatt==null) throw new IOException("Could not create BLE GATT connection");
        try {
            if(!ready.await(15,TimeUnit.SECONDS)) throw new IOException("BLE service/notification setup timed out");
            check();
        } catch(InterruptedException error) {Thread.currentThread().interrupt();close();throw new IOException(error);}
          catch(IOException error) {close();throw error;}
    }
    private void check() throws IOException {
        if(failure!=null) throw failure;
        if(closed) throw new IOException("BLE disconnected");
    }
    private void fail(String message) {
        failure=new IOException(message);ready.countDown();
        CountDownLatch ack=writeAck;if(ack!=null) ack.countDown();
    }
    private void notification(byte[] bytes) {
        if(bytes!=null && !closed && !received.offer(bytes.clone())) fail("BLE receive queue overflow; reconnect");
    }
    private final BluetoothGattCallback callbacks=new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt link,int status,int state) {
            if(status==BluetoothGatt.GATT_SUCCESS && state==BluetoothProfile.STATE_CONNECTED) {
                if(!link.discoverServices()) fail("BLE service discovery failed");
            } else if(state==BluetoothProfile.STATE_DISCONNECTED || status!=BluetoothGatt.GATT_SUCCESS) fail("BLE connection lost ("+status+")");
        }
        @Override public void onServicesDiscovered(BluetoothGatt link,int status) {
            if(status!=BluetoothGatt.GATT_SUCCESS) {fail("BLE service discovery failed");return;}
            BluetoothGattService service=link.getService(SERVICE);
            if(service==null) {fail("Device has no RC UART service");return;}
            rx=service.getCharacteristic(RX);
            BluetoothGattCharacteristic tx=service.getCharacteristic(TX);
            if(rx==null || tx==null || !link.setCharacteristicNotification(tx,true)) {fail("BLE UART characteristics unavailable");return;}
            BluetoothGattDescriptor descriptor=tx.getDescriptor(CCCD);
            if(descriptor==null) {fail("BLE notification descriptor unavailable");return;}
            descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            if(!link.writeDescriptor(descriptor)) fail("BLE notification setup failed");
        }
        @Override public void onDescriptorWrite(BluetoothGatt link,BluetoothGattDescriptor descriptor,int status) {
            if(!CCCD.equals(descriptor.getUuid())) return;
            if(status!=BluetoothGatt.GATT_SUCCESS) fail("BLE notifications rejected");else ready.countDown();
        }
        @Override public void onCharacteristicChanged(BluetoothGatt link,BluetoothGattCharacteristic characteristic) {
            if(TX.equals(characteristic.getUuid())) notification(characteristic.getValue());
        }
        @Override public void onCharacteristicChanged(BluetoothGatt link,BluetoothGattCharacteristic characteristic,byte[] bytes) {
            if(TX.equals(characteristic.getUuid())) notification(bytes);
        }
        @Override public void onCharacteristicWrite(BluetoothGatt link,BluetoothGattCharacteristic characteristic,int status) {
            if(!RX.equals(characteristic.getUuid())) return;
            if(status!=BluetoothGatt.GATT_SUCCESS) fail("BLE write rejected ("+status+")");
            CountDownLatch ack=writeAck;if(ack!=null) ack.countDown();
        }
    };
    public int read(byte[] bytes) throws IOException {
        check();
        try {
            if(current==null || offset==current.length) {current=received.poll(200,TimeUnit.MILLISECONDS);offset=0;}
            check();if(current==null) return 0;
            int count=Math.min(bytes.length,current.length-offset);
            System.arraycopy(current,offset,bytes,0,count);offset+=count;return count;
        } catch(InterruptedException error) {Thread.currentThread().interrupt();throw new IOException(error);}
    }
    public synchronized void write(byte[] bytes) throws IOException {
        for(int start=0;start<bytes.length;start+=20) {
            check();CountDownLatch ack=new CountDownLatch(1);writeAck=ack;
            rx.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            rx.setValue(Arrays.copyOfRange(bytes,start,Math.min(start+20,bytes.length)));
            if(!gatt.writeCharacteristic(rx)) throw new IOException("BLE write could not start");
            try {if(!ack.await(5,TimeUnit.SECONDS)) throw new IOException("BLE write timed out");}
            catch(InterruptedException error) {Thread.currentThread().interrupt();throw new IOException(error);}
            check();writeAck=null;
        }
    }
    public void close() {
        closed=true;ready.countDown();CountDownLatch ack=writeAck;if(ack!=null) ack.countDown();
        if(gatt!=null) {gatt.disconnect();gatt.close();}
    }
}
