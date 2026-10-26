package com.shrieeiee.mechforce;

import android.os.Bundle;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

// Fullscreen landscape host for the game, plus a controller bridge:
// gamepad buttons and sticks are forwarded to window.__mfNativePad so every
// Android controller (Xbox, PlayStation, 8BitDo, Razer Kishi...) works the same.
public class MainActivity extends BridgeActivity {
    private final boolean[] btn = new boolean[17];
    private final float[] axes = new float[4];
    private float lt = 0f, rt = 0f;
    private String kind = "xbox";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MechForceNativePlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemUI();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUI();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemUI() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    private static boolean isPad(InputDevice d) {
        if (d == null) return false;
        int s = d.getSources();
        return (s & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD || (s & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
    }

    private static int map(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_BUTTON_A: return 0;
            case KeyEvent.KEYCODE_BUTTON_B: return 1;
            case KeyEvent.KEYCODE_BUTTON_X: return 2;
            case KeyEvent.KEYCODE_BUTTON_Y: return 3;
            case KeyEvent.KEYCODE_BUTTON_L1: return 4;
            case KeyEvent.KEYCODE_BUTTON_R1: return 5;
            case KeyEvent.KEYCODE_BUTTON_L2: return 6;
            case KeyEvent.KEYCODE_BUTTON_R2: return 7;
            case KeyEvent.KEYCODE_BUTTON_SELECT: return 8;
            case KeyEvent.KEYCODE_BUTTON_START: return 9;
            case KeyEvent.KEYCODE_BUTTON_THUMBL: return 10;
            case KeyEvent.KEYCODE_BUTTON_THUMBR: return 11;
            case KeyEvent.KEYCODE_DPAD_UP: return 12;
            case KeyEvent.KEYCODE_DPAD_DOWN: return 13;
            case KeyEvent.KEYCODE_DPAD_LEFT: return 14;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return 15;
            case KeyEvent.KEYCODE_BUTTON_MODE: return 16;
            default: return -1;
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        InputDevice dev = e.getDevice();
        boolean pad = isPad(dev) || KeyEvent.isGamepadButton(e.getKeyCode());
        if (pad) {
            int code = e.getKeyCode();
            // Many pads report B as BACK; treat it as the B button.
            if (code == KeyEvent.KEYCODE_BACK) code = KeyEvent.KEYCODE_BUTTON_B;
            int i = map(code);
            if (i >= 0) {
                if (e.getRepeatCount() == 0) {
                    btn[i] = e.getAction() == KeyEvent.ACTION_DOWN;
                    detectKind(dev);
                    push();
                }
                return true;
            }
        } else if (e.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() == KeyEvent.ACTION_UP) js("window.dispatchEvent(new CustomEvent('mf-back'))");
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent e) {
        if (isPad(e.getDevice()) && e.getAction() == MotionEvent.ACTION_MOVE) {
            axes[0] = e.getAxisValue(MotionEvent.AXIS_X);
            axes[1] = e.getAxisValue(MotionEvent.AXIS_Y);
            axes[2] = e.getAxisValue(MotionEvent.AXIS_Z);
            axes[3] = e.getAxisValue(MotionEvent.AXIS_RZ);
            lt = Math.max(e.getAxisValue(MotionEvent.AXIS_LTRIGGER), e.getAxisValue(MotionEvent.AXIS_BRAKE));
            rt = Math.max(e.getAxisValue(MotionEvent.AXIS_RTRIGGER), e.getAxisValue(MotionEvent.AXIS_GAS));
            float hx = e.getAxisValue(MotionEvent.AXIS_HAT_X), hy = e.getAxisValue(MotionEvent.AXIS_HAT_Y);
            btn[14] = hx < -0.5f; btn[15] = hx > 0.5f; btn[12] = hy < -0.5f; btn[13] = hy > 0.5f;
            detectKind(e.getDevice());
            push();
            return true;
        }
        return super.dispatchGenericMotionEvent(e);
    }

    private void detectKind(InputDevice d) {
        if (d == null) return;
        kind = (d.getVendorId() == 0x054c || d.getName().toLowerCase().contains("playstation") || d.getName().toLowerCase().contains("dualsense")) ? "ps" : "xbox";
    }

    private void push() {
        StringBuilder sb = new StringBuilder("{\"kind\":\"").append(kind).append("\",\"buttons\":[");
        for (int i = 0; i < btn.length; i++) { if (i > 0) sb.append(','); sb.append(btn[i] ? "true" : "false"); }
        sb.append("],\"axes\":[");
        for (int i = 0; i < 4; i++) { if (i > 0) sb.append(','); sb.append(Float.isNaN(axes[i]) ? 0 : axes[i]); }
        sb.append("],\"triggers\":[").append(lt).append(',').append(rt).append("]}");
        js("window.__mfNativePad&&window.__mfNativePad(" + sb + ")");
    }

    private void js(String code) {
        if (getBridge() == null) return;
        WebView wv = getBridge().getWebView();
        if (wv != null) wv.post(() -> wv.evaluateJavascript(code, null));
    }
}
