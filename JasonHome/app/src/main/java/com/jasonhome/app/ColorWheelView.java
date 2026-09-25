package com.jasonhome.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.graphics.SweepGradient;
import android.view.MotionEvent;
import android.view.View;

final class ColorWheelView extends View {
    interface Listener {
        void onColorChanged(int rgb);
    }

    private final Paint huePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint whiteOverlayPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint markerOuter = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint markerInner = new Paint(Paint.ANTI_ALIAS_FLAG);
    private float hue = 0f;
    private float saturation = 0f;
    private Listener listener;

    ColorWheelView(Context context) {
        super(context);
        markerOuter.setStyle(Paint.Style.STROKE);
        markerOuter.setStrokeWidth(dp(3));
        markerOuter.setColor(Color.WHITE);
        markerOuter.setShadowLayer(dp(2), 0, dp(1), Color.BLACK);
        setLayerType(LAYER_TYPE_SOFTWARE, null);
        markerInner.setStyle(Paint.Style.FILL);
    }

    void setListener(Listener listener) {
        this.listener = listener;
    }

    void setColor(int rgb) {
        float[] hsv = new float[3];
        Color.RGBToHSV((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, hsv);
        hue = hsv[0];
        saturation = hsv[1];
        invalidate();
    }

    int getColor() {
        return Color.HSVToColor(new float[]{hue, saturation, 1f}) & 0xFFFFFF;
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float cx = getWidth() / 2f;
        float cy = getHeight() / 2f;
        float radius = Math.max(1f, Math.min(getWidth(), getHeight()) / 2f - dp(8));

        int[] hueColors = {
            Color.RED,
            Color.YELLOW,
            Color.GREEN,
            Color.CYAN,
            Color.BLUE,
            Color.MAGENTA,
            Color.RED
        };
        huePaint.setShader(new SweepGradient(cx, cy, hueColors, null));
        canvas.drawCircle(cx, cy, radius, huePaint);

        whiteOverlayPaint.setShader(new RadialGradient(
            cx, cy, radius,
            new int[]{Color.WHITE, 0x00FFFFFF},
            new float[]{0f, 1f},
            Shader.TileMode.CLAMP
        ));
        canvas.drawCircle(cx, cy, radius, whiteOverlayPaint);

        double a = Math.toRadians(hue);
        float mx = cx + (float)Math.cos(a) * saturation * radius;
        float my = cy + (float)Math.sin(a) * saturation * radius;
        markerInner.setColor(Color.HSVToColor(new float[]{hue, saturation, 1f}));
        canvas.drawCircle(mx, my, dp(9), markerInner);
        canvas.drawCircle(mx, my, dp(10), markerOuter);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (event.getAction() != MotionEvent.ACTION_DOWN &&
            event.getAction() != MotionEvent.ACTION_MOVE) return true;

        float cx = getWidth() / 2f;
        float cy = getHeight() / 2f;
        float radius = Math.max(1f, Math.min(getWidth(), getHeight()) / 2f - dp(8));
        float dx = event.getX() - cx;
        float dy = event.getY() - cy;
        float distance = (float)Math.sqrt(dx * dx + dy * dy);
        saturation = Math.max(0f, Math.min(1f, distance / radius));

        float degrees = (float)Math.toDegrees(Math.atan2(dy, dx));
        if (degrees < 0f) degrees += 360f;
        hue = degrees;

        invalidate();
        if (listener != null) listener.onColorChanged(getColor());
        return true;
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }
}
