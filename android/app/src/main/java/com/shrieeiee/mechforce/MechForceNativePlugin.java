package com.shrieeiee.mechforce;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

// Tells the game this phone's LAN address so host discovery scans the right subnet first.
@CapacitorPlugin(name = "MechForceNative")
public class MechForceNativePlugin extends Plugin {
    @PluginMethod
    public void localIp(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ip", findIp());
        call.resolve(r);
    }

    private static String findIp() {
        try {
            String fallback = "";
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
                        String ip = a.getHostAddress();
                        if (ni.getName().startsWith("wlan")) return ip;
                        if (fallback.isEmpty()) fallback = ip;
                    }
                }
            }
            return fallback;
        } catch (Exception e) {
            return "";
        }
    }
}
