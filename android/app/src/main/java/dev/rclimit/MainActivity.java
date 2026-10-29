package dev.rclimit;

import android.Manifest;
import android.app.*;
import android.bluetooth.*;
import android.bluetooth.le.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.hardware.usb.*;
import android.net.Uri;
import android.os.*;
import android.text.InputType;
import android.view.*;
import android.widget.*;
import com.hoho.android.usbserial.driver.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Native Android UI and transports. No WebView, network service, or JS bridge. */
public class MainActivity extends Activity {
    private static final String USB_PERMISSION="dev.rclimit.USB_PERMISSION";
    private static final UUID SPP=UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");
    private static final String[] KEYS={"input_pin","output_pin","input_min","input_neutral","input_max",
        "output_min","output_neutral","output_max","forward_percent","reverse_percent",
        "bidirectional","scale","invert","deadband","timeout_ms"};
    private static final String[] LABELS={"Receiver GPIO","ESC GPIO","Receiver minimum µs","Receiver neutral µs",
        "Receiver maximum µs","ESC minimum µs","ESC neutral / stop µs","ESC maximum µs","Forward limit %",
        "Reverse limit %","Mode: 0 forward, 1 bidirectional","Mapping: 0 clamp, 1 scale","Invert: 0 no, 1 yes",
        "Neutral deadband µs","Signal loss timeout ms"};
    private static final int[] DEFAULTS={4,5,1000,1500,2000,1000,1500,2000,30,30,1,1,0,30,100};
    private final Handler ui=new Handler(Looper.getMainLooper());
    private final ExecutorService writes=Executors.newSingleThreadExecutor();
    private final Map<String,EditText> fields=new LinkedHashMap<>();
    private final Map<Integer,Pending> pending=new HashMap<>();
    private final List<Button> deviceButtons=new ArrayList<>();
    private int nextId=0, generation=0;
    private volatile Link link;
    private TextView status, notice;
    private EditText deviceName;
    private Button renameButton;
    private String lastDeviceName="",lastDeviceId="";
    private Button applyButton,saveButton,armButton;
    private UsbManager usb;
    private boolean active=false, ready=false, connecting=false;
    private UsbDevice requestedDevice;
    private String exportedProfile;
    private final List<JSONObject> draftMappings=new ArrayList<>();
    private Spinner mappingSelector;
    private Button addMappingButton,removeMappingButton;
    private int selectedMapping=0,protocolVersion=1;
    private String currentBoard="";
    private boolean refreshingMappings=false,boardArmed=false;
    private BluetoothLeScanner bleScanner;
    private ScanCallback bleScanCallback;
    private AlertDialog blePicker;

    interface Link extends Closeable { int read(byte[] buffer) throws IOException; void write(byte[] data) throws IOException; }
    interface Success { void run(JSONObject data) throws JSONException; }
    static class Pending {
        Success success; Runnable timeout;
        Pending(Success success,Runnable timeout) { this.success=success; this.timeout=timeout; }
    }
    private final BroadcastReceiver usbReceiver=new BroadcastReceiver() {
        @Override public void onReceive(Context context,Intent intent) {
            if(USB_PERMISSION.equals(intent.getAction())) {
                if(requestedDevice==null) return;
                UsbDevice device=requestedDevice; requestedDevice=null;
                // Check the system grant rather than trusting broadcast extras.
                if(usb.hasPermission(device)) openUsb(device); else tell("USB permission denied.");
            } else if(UsbManager.ACTION_USB_DEVICE_DETACHED.equals(intent.getAction()) && link instanceof UsbLink) {
                UsbDevice device=intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if(device!=null && device.equals(((UsbLink)link).device)) disconnect(false);
            }
        }
    };

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved); usb=(UsbManager)getSystemService(USB_SERVICE);
        ScrollView scroll=new ScrollView(this);
        LinearLayout layout=new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
        int pad=(int)(20*getResources().getDisplayMetrics().density); layout.setPadding(pad,pad,pad,pad);
        scroll.addView(layout); setContentView(scroll);
        // Consume system bars on Android 15, including when edge-to-edge is enforced.
        scroll.setOnApplyWindowInsetsListener((view,insets)->{
            view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom()); return insets;
        });
        TextView title=new TextView(this); title.setText("RC LIMIT / WORKSHOP"); title.setTextSize(26); layout.addView(title);
        text(layout,"Bidirectional ESC configuration\nRemove propeller / unload drivetrain before setup.");
        status=text(layout,"OFFLINE · output state unknown");
        LinearLayout connections=row(layout);
        button(connections,"USB OTG",this::chooseUsb,false);
        button(connections,"Bluetooth",this::chooseBluetooth,false);
        button(connections,"BLE C3",this::chooseBle,false);
        button(connections,"Disconnect",()->disconnect(true),false);
        notice=text(layout,"Defaults shown until Read board. Pico: USB. Original ESP32: USB / Classic. C3: USB / BLE C3.");
        deviceName=new EditText(this);deviceName.setSingleLine(true);deviceName.setHint("Device name (1–16 characters)");layout.addView(deviceName);
        renameButton=button(row(layout),"Save device name",()->{
            String name=deviceName.getText().toString();
            if(!name.matches("[A-Za-z0-9 ._-]{1,16}") || name.startsWith(" ") || name.endsWith(" ")) {tell("Use 1–16 letters, numbers, spaces, dots, underscores or hyphens; no outer spaces.");return;}
            try {send("set_name",new JSONObject().put("name",name),data->tell("Name saved. Restart with motor power disconnected to update Bluetooth discovery."));}
            catch(JSONException error) {tell(error.getMessage());}
        },true);
        button(row(layout),"Board layouts / suggested GPIOs / 5 V resistors",this::showBoardGuide,false);
        text(layout,"Receiver → ESC mappings (1–4). Limits below apply to the selected mapping.");
        mappingSelector=new Spinner(this); layout.addView(mappingSelector);
        mappingSelector.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            public void onNothingSelected(AdapterView<?> parent) {}
            public void onItemSelected(AdapterView<?> parent,View view,int position,long id) {
                if(refreshingMappings || position==selectedMapping) return;
                try { stashMapping(); selectedMapping=position; refreshMappings(); }
                catch(Exception error) { mappingSelector.setSelection(selectedMapping); tell(error.getMessage()); }
            }
        });
        LinearLayout mappingActions=row(layout);
        addMappingButton=button(mappingActions,"+ Mapping",this::addMapping,false);
        removeMappingButton=button(mappingActions,"Remove",()->{
            if(draftMappings.size()<=1) return;
            draftMappings.remove(selectedMapping); selectedMapping=Math.min(selectedMapping,draftMappings.size()-1);
            try { refreshMappings(); tell("Removed from draft. Apply all to update the board."); } catch(JSONException error) { tell(error.getMessage()); }
        },false);
        for(int i=0;i<KEYS.length;i++) {
            text(layout,LABELS[i]);
            EditText input=new EditText(this); input.setSingleLine(true);
            input.setInputType(InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_SIGNED);
            input.setText(Integer.toString(DEFAULTS[i]));
            input.setContentDescription(LABELS[i]); fields.put(KEYS[i],input); layout.addView(input);
        }
        try { draftMappings.add(form()); refreshMappings(); } catch(JSONException error) { throw new IllegalStateException(error); }
        text(layout,"Scale uses the full stick travel within the limit. Clamp caps the original command. Limits are not measured speed or power.");
        LinearLayout actions=row(layout);
        button(actions,"Read board",()->send("get",null,this::loadMappings),true);
        applyButton=button(actions,"Apply all",()->{
            try {
                JSONObject value=mappingProfile();
                if(protocolVersion<2 && draftMappings.size()>1) throw new JSONException("Upgrade board firmware to use multiple mappings.");
                send(protocolVersion>=2?"set_mappings":"set",protocolVersion>=2?value:draftMappings.get(0),data->{loadMappings(data);tell("All mappings applied to RAM. Save to retain settings.");});
            }
            catch(Exception error) { tell(error.getMessage()); }
        },true);
        saveButton=button(actions,"Save flash",()->send("save",null,data->tell("Saved to board flash.")),true);
        LinearLayout run=row(layout);
        armButton=button(run,"ARM ALL",()->send("arm",null,data->tell("All outputs armed within configured limits.")),true);
        button(run,"DISARM ALL",()->send("disarm",null,data->tell("Board confirmed DISARM; all stop pulses active.")),true);
        LinearLayout profiles=row(layout);
        button(profiles,"Import JSON",this::importProfile,false);
        button(profiles,"Export JSON",this::exportProfile,false);
        text(layout,"Hold every mapped receiver input at stop for 1 second before ARM ALL. Losing any input disarms all outputs. Shared inputs are allowed; outputs must be unique. App disconnect or backgrounding requests disarm but cannot guarantee delivery.");
        IntentFilter filter=new IntentFilter(USB_PERMISSION); filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        // USB permission PendingIntent returns through a private explicit-package broadcast.
        if(Build.VERSION.SDK_INT>=33) registerReceiver(usbReceiver,filter,Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(usbReceiver,filter);
        enable(false);
    }
    private TextView text(LinearLayout parent,String value) {
        TextView view=new TextView(this); view.setText(value); view.setTextSize(14); view.setPadding(0,12,0,8); parent.addView(view); return view;
    }
    private LinearLayout row(LinearLayout parent) {
        LinearLayout row=new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL); parent.addView(row); return row;
    }
    private Button button(LinearLayout parent,String label,Runnable action,boolean device) {
        Button button=new Button(this); button.setText(label); button.setTextSize(11);
        parent.addView(button,new LinearLayout.LayoutParams(0,LinearLayout.LayoutParams.WRAP_CONTENT,1));
        button.setOnClickListener(view->action.run()); if(device) deviceButtons.add(button); return button;
    }
    private void tell(String message) { notice.setText(message==null?"Unknown error":message); }
    private void enable(boolean enabled) { for(Button b:deviceButtons) b.setEnabled(enabled); }
    private void fill(JSONObject config) throws JSONException {
        validate(config);
        for(String key:KEYS) fields.get(key).setText(Integer.toString(config.getInt(key)));
    }
    private JSONObject form() throws JSONException {
        JSONObject config=new JSONObject();
        for(String key:KEYS) config.put(key,Integer.parseInt(fields.get(key).getText().toString().trim()));
        validate(config); return config;
    }
    private void stashMapping() throws JSONException { draftMappings.set(selectedMapping,form()); }
    private void refreshMappings() throws JSONException {
        refreshingMappings=true;
        try {
            List<String> labels=new ArrayList<>();
            for(int i=0;i<draftMappings.size();i++) {
                JSONObject c=draftMappings.get(i);
                labels.add((i+1)+": GPIO"+c.getInt("input_pin")+" → GPIO"+c.getInt("output_pin"));
            }
            mappingSelector.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,labels));
            mappingSelector.setSelection(selectedMapping); fill(draftMappings.get(selectedMapping));
            addMappingButton.setEnabled(!boardArmed && draftMappings.size()<4);
            removeMappingButton.setEnabled(!boardArmed && draftMappings.size()>1);
        } finally { refreshingMappings=false; }
    }
    private boolean allowedPin(int pin,boolean output) {
        if(currentBoard.equals("pico")) return (pin>=0 && pin<=22) || (pin>=26 && pin<=28);
        if(currentBoard.equals("esp32c3")) return pin==0 || pin==1 || (pin>=3 && pin<=7) || pin==10;
        if(!currentBoard.equals("esp32")) return true;
        for(int p:new int[]{18,19,21,22,23,25,26,27,32,33}) if(p==pin) return true;
        if(!output) for(int p:new int[]{34,35,36,39}) if(p==pin) return true;
        return false;
    }
    private void validateMappings(List<JSONObject> list) throws JSONException {
        if(list.size()<1 || list.size()>4) throw new JSONException("Use 1–4 mappings.");
        for(int i=0;i<list.size();i++) {
            JSONObject c=list.get(i); validate(c);
            int input=c.getInt("input_pin"),output=c.getInt("output_pin");
            if(!allowedPin(input,false) || !allowedPin(output,true)) throw new JSONException("Mapping "+(i+1)+": GPIO unavailable on "+currentBoard);
            for(int j=0;j<list.size();j++) {
                JSONObject other=list.get(j);
                if(output==other.getInt("input_pin")) throw new JSONException("Output GPIO cannot also be a receiver input.");
                if(i!=j && output==other.getInt("output_pin")) throw new JSONException("Each output GPIO must be unique.");
                if(currentBoard.equals("pico") && i!=j && output%16==other.getInt("output_pin")%16) throw new JSONException("Pico outputs 16 GPIOs apart share a PWM channel.");
            }
        }
    }
    private JSONObject mappingProfile() throws JSONException {
        stashMapping(); validateMappings(draftMappings);
        JSONArray list=new JSONArray(); for(JSONObject c:draftMappings) list.put(c);
        return new JSONObject().put("version",2).put("mappings",list);
    }
    private void loadProfile(JSONObject value) throws JSONException {
        List<JSONObject> next=new ArrayList<>();
        if(value.optInt("version")==2 && value.length()==2 && value.has("mappings")) {
            JSONArray array=value.getJSONArray("mappings");
            for(int i=0;i<array.length();i++) next.add(array.getJSONObject(i));
        } else next.add(value);
        validateMappings(next); draftMappings.clear(); draftMappings.addAll(next);
        selectedMapping=0; refreshMappings();
    }
    private void loadMappings(JSONObject data) throws JSONException {
        loadProfile(data.has("mappings")?new JSONObject().put("version",2).put("mappings",data.getJSONArray("mappings")):data.getJSONObject("config"));
    }
    private void addMapping() {
        try {
            stashMapping();
            int[][] pairs=currentBoard.equals("esp32c3")?new int[][]{{3,4},{5,6},{0,1},{7,10}}:currentBoard.equals("esp32")?new int[][]{{27,25},{26,33},{32,18},{19,21}}:new int[][]{{4,5},{6,7},{8,9},{10,11}};
            for(int[] pair:pairs) {
                JSONObject candidate=new JSONObject();
                for(int i=0;i<KEYS.length;i++) candidate.put(KEYS[i],DEFAULTS[i]);
                candidate.put("input_pin",pair[0]).put("output_pin",pair[1]);
                List<JSONObject> next=new ArrayList<>(draftMappings); next.add(candidate);
                try { validateMappings(next); } catch(JSONException ignored) { continue; }
                draftMappings.add(candidate); selectedMapping=draftMappings.size()-1; refreshMappings();
                tell("Added to draft. Configure each mapping, then Apply all."); return;
            }
            tell("No unused suggested pair. Adjust pins or remove a mapping first.");
        } catch(Exception error) { tell(error.getMessage()); }
    }
    private void validate(JSONObject c) throws JSONException {
        if(c.length()!=KEYS.length) throw new JSONException("Profile must contain exactly 15 integer fields.");
        for(String key:KEYS) if(!(c.get(key) instanceof Integer)) throw new JSONException("Invalid integer: "+key);
        for(String prefix:new String[]{"input","output"}) {
            int min=c.getInt(prefix+"_min"), center=c.getInt(prefix+"_neutral"), max=c.getInt(prefix+"_max");
            if(min<800 || max>2200 || min>=center || center>=max) throw new JSONException(prefix+": use minimum < neutral < maximum within 800–2200 µs.");
        }
        for(String key:new String[]{"forward_percent","reverse_percent"}) if(c.getInt(key)<0 || c.getInt(key)>100) throw new JSONException("Limits must be 0–100%.");
        for(String key:new String[]{"bidirectional","scale","invert"}) if(c.getInt(key)<0 || c.getInt(key)>1) throw new JSONException(key+" must be 0 or 1.");
        int deadband=c.getInt("deadband"), timeout=c.getInt("timeout_ms");
        if(deadband<0 || deadband>100 || deadband>=c.getInt("input_neutral")-c.getInt("input_min") ||
           deadband>=c.getInt("input_max")-c.getInt("input_neutral")) throw new JSONException("Invalid deadband (0–100 µs).");
        if(timeout<40 || timeout>250) throw new JSONException("Timeout must be 40–250 ms.");
        if(c.getInt("input_pin")==c.getInt("output_pin") || c.getInt("input_pin")<0 || c.getInt("output_pin")<0) throw new JSONException("Choose two different GPIOs.");
    }

    private void chooseUsb() {
        if(connecting || link!=null) { tell("Disconnect before choosing another board."); return; }
        List<UsbSerialDriver> drivers=UsbSerialProber.getDefaultProber().findAllDrivers(usb);
        if(drivers.isEmpty()) { tell("No supported USB serial board. Use a data-capable OTG adapter/cable."); return; }
        String[] labels=new String[drivers.size()];
        for(int i=0;i<labels.length;i++) {
            UsbDevice d=drivers.get(i).getDevice(); labels[i]=d.getDeviceName()+String.format(Locale.ROOT," [%04x:%04x]",d.getVendorId(),d.getProductId());
        }
        new AlertDialog.Builder(this).setTitle("Choose USB serial board").setItems(labels,(dialog,index)->{
            UsbDevice device=drivers.get(index).getDevice();
            if(usb.hasPermission(device)) openUsb(device);
            else {
                requestedDevice=device;
                PendingIntent permission=PendingIntent.getBroadcast(this,0,new Intent(USB_PERMISSION).setPackage(getPackageName()),PendingIntent.FLAG_IMMUTABLE);
                usb.requestPermission(device,permission);
            }
        }).show();
    }
    private void openUsb(UsbDevice device) {
        if(!active || link!=null || connecting) return;
        connecting=true; int token=++generation;
        tell("Opening USB serial…");
        writes.execute(()->{
            UsbLink opened=null;
            try {
                opened=new UsbLink(device); Link result=opened;
                ui.post(()->accept(result,token));
            } catch(Exception error) { closeQuietly(opened); ui.post(()->failedConnect(token,error)); }
        });
    }
    private void chooseBluetooth() {
        if(connecting || link!=null) { tell("Disconnect before choosing another board."); return; }
        if(Build.VERSION.SDK_INT>=31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT},42); return;
        }
        BluetoothManager manager=(BluetoothManager)getSystemService(BLUETOOTH_SERVICE);
        BluetoothAdapter adapter=manager.getAdapter();
        if(adapter==null || !adapter.isEnabled()) { tell("Enable Bluetooth and pair RC-Limiter in Android settings first."); return; }
        List<BluetoothDevice> devices=new ArrayList<>(adapter.getBondedDevices());
        if(devices.isEmpty()) { tell("Pair RC-Limiter in Android Bluetooth settings, then retry."); return; }
        String[] labels=new String[devices.size()];
        for(int i=0;i<labels.length;i++) labels[i]=devices.get(i).getName()+" · "+devices.get(i).getAddress();
        new AlertDialog.Builder(this).setTitle("Choose paired ESP32 (SPP)").setItems(labels,(dialog,index)->{
            connecting=true; int token=++generation; tell("Connecting Bluetooth…");
            writes.execute(()->{
                BluetoothSocket socket=null;
                try {
                    socket=devices.get(index).createRfcommSocketToServiceRecord(SPP);
                    // Bound a failed RFCOMM connection so lifecycle changes cannot leave IO stuck forever.
                    BluetoothSocket current=socket;
                    ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor();
                    ScheduledFuture<?> timeout=timer.schedule(()->closeQuietly(current),12,TimeUnit.SECONDS);
                    try { socket.connect(); } finally { timeout.cancel(false); timer.shutdown(); }
                    Link result=new BluetoothLink(socket); ui.post(()->accept(result,token));
                } catch(Exception error) { closeQuietly(socket); ui.post(()->failedConnect(token,error)); }
            });
        }).show();
    }
    private void showBoardGuide() {
        try(InputStream input=getAssets().open("boards.json")) {
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[1024];int n;
            while((n=input.read(buffer))!=-1) bytes.write(buffer,0,n);
            JSONArray boards=new JSONArray(bytes.toString(StandardCharsets.UTF_8.name()));
            String[] labels=new String[boards.length()];for(int i=0;i<labels.length;i++) labels[i]=boards.getJSONObject(i).getString("name");
            new AlertDialog.Builder(this).setTitle("Board layout reference").setItems(labels,(dialog,index)->{
                try {
                    JSONObject b=boards.getJSONObject(index);StringBuilder text=new StringBuilder("Component/top view · USB at "+b.getString("usb")+"\n\n");
                    JSONArray left=b.getJSONArray("left"),right=b.getJSONArray("right"),lp=b.getJSONArray("left_positions"),rp=b.getJSONArray("right_positions");
                    for(int i=0;i<left.length();i++) text.append(String.format(Locale.ROOT,"%-17s %s\n",lp.getString(i)+" "+left.getString(i),rp.getString(i)+" "+right.getString(i)));
                    text.append("\nSuggested receiver → ESC GPIOs:\n");JSONArray pairs=b.getJSONArray("pairs");
                    for(int i=0;i<pairs.length();i++) {JSONArray pair=pairs.getJSONArray(i);text.append(pair.getInt(0)).append(" → ").append(pair.getInt(1)).append("\n");}
                    text.append("\n").append(b.getString("notes")).append("\n\nAll GPIOs are 3.3 V, not 5 V tolerant. For a confirmed 5 V PWM signal: receiver → 4.7 kΩ → GPIO, plus 6.8 kΩ from GPIO to ground (1% resistors): about 2.96 V. A 3.3 V signal becomes 1.95 V and may not register. Prefer SN74LVC1G17 at 3.3 V if power sequencing varies. Add 10 kΩ from each ESC output GPIO to ground; optional 100–220 Ω output series resistor only reduces ringing, not voltage.\n\n").append(b.getString("source"));
                    TextView view=new TextView(this);view.setText(text);view.setTextSize(12);view.setTypeface(android.graphics.Typeface.MONOSPACE);view.setPadding(20,20,20,20);view.setTextIsSelectable(true);
                    ScrollView scroll=new ScrollView(this);scroll.addView(view);
                    new AlertDialog.Builder(this).setTitle(b.getString("name")).setView(scroll).setPositiveButton("Close",null).show();
                } catch(JSONException error) {tell(error.getMessage());}
            }).show();
        } catch(Exception error) {tell("Board guide unavailable: "+error.getMessage());}
    }
    private void stopBleScan() {
        if(bleScanner!=null && bleScanCallback!=null) try {bleScanner.stopScan(bleScanCallback);}catch(SecurityException ignored){}
        bleScanner=null;bleScanCallback=null;
    }
    private void chooseBle() {
        if(connecting || link!=null) {tell("Disconnect before choosing another board.");return;}
        String[] permissions=Build.VERSION.SDK_INT>=31?new String[]{Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT}:new String[]{Manifest.permission.ACCESS_FINE_LOCATION};
        for(String permission:permissions) if(checkSelfPermission(permission)!=PackageManager.PERMISSION_GRANTED) {requestPermissions(permissions,43);return;}
        BluetoothAdapter adapter=((BluetoothManager)getSystemService(BLUETOOTH_SERVICE)).getAdapter();
        if(adapter==null || !adapter.isEnabled() || adapter.getBluetoothLeScanner()==null) {tell("Enable Bluetooth before scanning for C3 BLE UART.");return;}
        stopBleScan();
        List<BluetoothDevice> devices=new ArrayList<>();ArrayAdapter<String> names=new ArrayAdapter<>(this,android.R.layout.simple_list_item_1);
        bleScanner=adapter.getBluetoothLeScanner();
        bleScanCallback=new ScanCallback() {
            @Override public void onScanResult(int type,ScanResult result) {
                ui.post(()->{
                    BluetoothDevice device=result.getDevice();if(bleScanner==null || devices.contains(device)) return;
                    devices.add(device);names.add((device.getName()==null?"RC UART":device.getName())+" · "+device.getAddress());names.notifyDataSetChanged();
                });
            }
            @Override public void onScanFailed(int code) {ui.post(()->{stopBleScan();tell("BLE scan failed ("+code+")");});}
        };
        blePicker=new AlertDialog.Builder(this).setTitle("Choose C3 BLE serial device").setAdapter(names,(dialog,index)->{
            BluetoothDevice device=devices.get(index);stopBleScan();connecting=true;int token=++generation;tell("Connecting C3 BLE UART…");
            writes.execute(()->{
                try {Link result=new BleLink(this,device);ui.post(()->accept(result,token));}
                catch(Exception error) {ui.post(()->failedConnect(token,error));}
            });
        }).setNegativeButton("Cancel",(dialog,which)->stopBleScan()).create();
        blePicker.setOnDismissListener(dialog->stopBleScan());blePicker.show();
        ScanCallback scan=bleScanCallback;
        bleScanner.startScan(Collections.singletonList(new ScanFilter.Builder().setServiceUuid(new ParcelUuid(BleLink.SERVICE)).build()),new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),scan);
        ui.postDelayed(()->{if(bleScanCallback==scan){stopBleScan();if(devices.isEmpty()) tell("No C3 BLE UART found. Check board power, firmware and Bluetooth permissions; on Android 8–11 enable Location for BLE scanning.");}},10000);
    }
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results) {
        super.onRequestPermissionsResult(code,permissions,results);
        if(code==42 && results.length>0 && results[0]==PackageManager.PERMISSION_GRANTED) chooseBluetooth();
        else if(code==42) tell("Bluetooth permission denied. USB remains available.");
        if(code==43) {
            boolean granted=results.length>0;for(int value:results) granted=granted && value==PackageManager.PERMISSION_GRANTED;
            if(granted) chooseBle();else tell("BLE permissions denied. USB remains available.");
        }
    }
    private void failedConnect(int token,Exception error) {
        if(token!=generation) return; connecting=false; tell("Connection failed: "+error.getMessage());
    }
    private void accept(Link connected,int token) {
        if(!active || token!=generation) { closeQuietly(connected); return; }
        connecting=false; link=connected; tell("Connected; waiting for board startup…");
        Thread reader=new Thread(()->readLoop(connected,token),"rc-limit-reader"); reader.start();
        ui.postDelayed(()->{
            if(token==generation && link==connected) {
                ready=true; enable(true); send("get",null,data->{loadMappings(data);tell("Board mappings loaded.");});
            }
        },2500);
    }
    private void readLoop(Link source,int token) {
        byte[] buffer=new byte[512]; ByteArrayOutputStream line=new ByteArrayOutputStream();
        try {
            while(link==source) {
                int count=source.read(buffer); if(count<0) throw new EOFException("Device disconnected");
                for(int i=0;i<count;i++) {
                    if(buffer[i]=='\n') {
                        String json=line.toString(StandardCharsets.UTF_8.name()); line.reset();
                        ui.post(()->{ if(token==generation) receive(json); });
                    } else if(buffer[i]!='\r') {
                        line.write(buffer[i]); if(line.size()>8192) throw new IOException("Board response too long");
                    }
                }
            }
        } catch(Exception error) {
            ui.post(()->{if(token==generation){tell("Transport lost: "+error.getMessage());disconnect(false);}});
        }
    }
    private void send(String command,JSONObject config,Success success) {
        Link destination=link; int token=generation;
        if(!ready || destination==null) { tell("Connect a board and wait for startup first."); return; }
        try {
            int id=++nextId; JSONObject request=new JSONObject().put("cmd",command).put("id",id);
            if(config!=null) {
                if(command.equals("set_name")) request.put("name",config.getString("name"));
                else if(command.equals("set_mappings")) request.put("mappings",config.getJSONArray("mappings"));
                else request.put("config",config);
            }
            Runnable timeout=()->{
                if(pending.remove(id)!=null){tell("No response. Output state unknown; use physical cutoff / transmitter stop.");disconnect(false);}
            };
            pending.put(id,new Pending(success,timeout)); ui.postDelayed(timeout,destination instanceof BleLink?15000:3000);
            byte[] bytes=(request+"\n").getBytes(StandardCharsets.UTF_8);
            writes.execute(()->{
                if(token!=generation || destination!=link) return;
                try { destination.write(bytes); }
                catch(IOException error) {ui.post(()->{if(token==generation){tell(error.getMessage());disconnect(false);}});}
            });
        } catch(JSONException error) { tell(error.getMessage()); }
    }
    private void receive(String json) {
        try {
            JSONObject data=new JSONObject(json); if(!data.has("ok")) return;
            boolean armed=data.getBoolean("armed"), healthy=data.getBoolean("signal_ok");
            boardArmed=armed; currentBoard=data.getString("board"); protocolVersion=data.optInt("protocol_version",1);
            String name=data.optString("device_name",""),identity=data.optString("device_id","");
            boolean names=data.has("device_name") && data.has("device_id");renameButton.setEnabled(names && !armed);
            if(names) {
                if(!identity.equals(lastDeviceId) || deviceName.getText().toString().equals(lastDeviceName)) deviceName.setText(name);
                lastDeviceName=name;lastDeviceId=identity;
            }
            StringBuilder live=new StringBuilder((names?name+" · ID "+identity+"\n":"")+currentBoard+" · "+(armed?"ARMED":"DISARMED")+" · RX "+(healthy?"ALL OK":"LOST / INVALID")+
                " · "+(data.getBoolean("saved")?"SAVED":"RAM ONLY"));
            JSONArray states=data.optJSONArray("channel_states"),configs=data.optJSONArray("mappings");
            if(states!=null && configs!=null) for(int i=0;i<states.length();i++) {
                JSONObject s=states.getJSONObject(i),c=configs.getJSONObject(i);
                live.append("\nLive ").append(i+1).append(": GPIO").append(c.getInt("input_pin")).append(" → GPIO").append(c.getInt("output_pin"))
                    .append(" · ").append(s.getInt("input_us")).append(" → ").append(s.getInt("output_us")).append(" µs · ").append(s.getBoolean("signal_ok")?"OK":"LOST");
            } else live.append("\nIN ").append(data.getInt("input_us")).append(" → OUT ").append(data.getInt("output_us")).append(" µs");
            JSONObject transports=data.optJSONObject("transports");
            live.append("\nUSB serial enabled · Bluetooth: ").append(transports!=null?(transports.optBoolean("bluetooth_serial")?transports.optString("bluetooth_name"):"unavailable"):(currentBoard.equals("esp32")?"RC-Limiter":"unavailable"));
            if(data.optBoolean("name_pending_restart")) live.append("\nName saved; restart to update Bluetooth discovery.");
            status.setText(live.toString());
            applyButton.setEnabled(!armed); saveButton.setEnabled(!armed); armButton.setEnabled(!armed && healthy);
            addMappingButton.setEnabled(!armed && draftMappings.size()<4); removeMappingButton.setEnabled(!armed && draftMappings.size()>1);
            Pending entry=pending.remove(data.optInt("id",0));
            if(entry!=null) {
                ui.removeCallbacks(entry.timeout);
                if(data.getBoolean("ok")) { if(entry.success!=null) entry.success.run(data); }
                else tell("Board rejected command: "+data.optString("error"));
            }
        } catch(JSONException ignored) { /* Ignore serial boot banners. */ }
    }
    private final Runnable poll=new Runnable() {
        @Override public void run() {
            if(active) {
                if(ready && pending.isEmpty()) send("get",null,null);
                ui.postDelayed(this,300);
            }
        }
    };
    private void disconnect(boolean stop) {
        Link old=link; link=null; ready=connecting=false; generation++; requestedDevice=null;
        for(Pending p:pending.values()) ui.removeCallbacks(p.timeout); pending.clear(); enable(false);
        lastDeviceName=lastDeviceId="";boardArmed=false; status.setText("OFFLINE · output state unknown");
        addMappingButton.setEnabled(draftMappings.size()<4); removeMappingButton.setEnabled(draftMappings.size()>1);
        if(old!=null) {
            if(old instanceof BleLink) ui.postDelayed(()->closeQuietly(old),1200);
            writes.execute(()->{
                try { if(stop) old.write("{\"cmd\":\"disarm\",\"id\":0}\n".getBytes(StandardCharsets.UTF_8)); }
                catch(IOException ignored) {} finally { closeQuietly(old); }
            });
            if(stop) tell("Disarm requested before disconnect; delivery is not confirmed.");
        }
    }
    private void importProfile() {
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(intent,100);
    }
    private void exportProfile() {
        try {
            exportedProfile=mappingProfile().toString(2)+"\n";
            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").putExtra(Intent.EXTRA_TITLE,"rc-limit-profile.json");
            startActivityForResult(intent,101);
        } catch(Exception error) { tell(error.getMessage()); }
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(result!=RESULT_OK || data==null || data.getData()==null) return;
        Uri uri=data.getData();
        try {
            if(request==100) {
                try(InputStream input=getContentResolver().openInputStream(uri)) {
                    ByteArrayOutputStream bytes=new ByteArrayOutputStream(); byte[] buffer=new byte[512]; int count;
                    while((count=input.read(buffer))!=-1) { bytes.write(buffer,0,count); if(bytes.size()>8192) throw new IOException("Profile too large"); }
                    loadProfile(new JSONObject(bytes.toString(StandardCharsets.UTF_8.name())));
                    tell("Imported into form. Connect, disarm and Apply to send it to the board.");
                }
            } else if(request==101 && exportedProfile!=null) {
                try(OutputStream output=getContentResolver().openOutputStream(uri,"wt")) {
                    output.write(exportedProfile.getBytes(StandardCharsets.UTF_8)); tell("Profile exported.");
                }
            }
        } catch(Exception error) { tell("Profile error: "+error.getMessage()); }
    }
    @Override protected void onStart() { super.onStart(); active=true; ui.post(poll); }
    @Override protected void onStop() { active=false; ui.removeCallbacks(poll); stopBleScan();if(blePicker!=null) blePicker.dismiss();disconnect(true); super.onStop(); }
    @Override protected void onDestroy() { unregisterReceiver(usbReceiver); writes.shutdown(); super.onDestroy(); }
    private static void closeQuietly(Closeable target) { if(target!=null) try {target.close();}catch(IOException ignored){} }

    private class UsbLink implements Link {
        final UsbDevice device; final UsbSerialPort port; final UsbDeviceConnection connection;
        UsbLink(UsbDevice device) throws IOException {
            this.device=device;
            UsbSerialDriver driver=UsbSerialProber.getDefaultProber().probeDevice(device);
            if(driver==null || driver.getPorts().isEmpty()) throw new IOException("No supported serial driver");
            connection=usb.openDevice(device); if(connection==null) throw new IOException("USB permission / open failed");
            port=driver.getPorts().get(0);
            try {
                port.open(connection); port.setParameters(115200,8,UsbSerialPort.STOPBITS_1,UsbSerialPort.PARITY_NONE);
                try {port.setDTR(driver instanceof CdcAcmSerialDriver); port.setRTS(false);}catch(UnsupportedOperationException ignored){}
            } catch(Exception error) { closeQuietly(port); connection.close(); throw new IOException(error); }
        }
        public int read(byte[] bytes) throws IOException { return port.read(bytes,200); }
        public void write(byte[] bytes) throws IOException { port.write(bytes,1000); }
        public void close() throws IOException { try{port.close();}finally{connection.close();} }
    }
    private static class BluetoothLink implements Link {
        final BluetoothSocket socket; final InputStream input; final OutputStream output;
        BluetoothLink(BluetoothSocket socket) throws IOException { this.socket=socket; input=socket.getInputStream(); output=socket.getOutputStream(); }
        public int read(byte[] bytes) throws IOException { return input.read(bytes); }
        public void write(byte[] bytes) throws IOException { output.write(bytes); output.flush(); }
        public void close() throws IOException { socket.close(); }
    }
}
