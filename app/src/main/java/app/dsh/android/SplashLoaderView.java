package app.dsh.android;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.LinearGradient;
import android.graphics.Shader;

/** Indeterminate light sweep, without suggesting a measured percentage. */
final class SplashLoaderView extends AmbientAnimationView {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private Shader light;
    private final android.graphics.Matrix matrix = new android.graphics.Matrix();
    private boolean failed;
    SplashLoaderView(Context context) {
        super(context);
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }
    void setFailed(boolean value) { failed = value; invalidate(); }
    @Override protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        if (w > 0) light = new LinearGradient(0, 0, w * .55f, 0,
            new int[] {0x008BBEFF, 0xFFB4D7FF, 0x008BBEFF},
            new float[] {0, .5f, 1}, Shader.TileMode.CLAMP);
    }
    @Override protected void onDraw(Canvas canvas) {
        float w = getWidth(), h = getHeight();
        float thickness = getResources().getDisplayMetrics().density * 2;
        float top = (getHeight() - thickness) / 2;
        paint.setShader(null);
        paint.setColor(failed ? 0xFFAC7972 : 0xFF243249);
        canvas.drawRoundRect(0, top, w, top + thickness, thickness, thickness, paint);
        if (failed || light == null) return;
        float phase = (seconds % 2.6f) / 2.6f;
        float x = -w * .55f + phase * w * 1.55f;
        if (!android.animation.ValueAnimator.areAnimatorsEnabled()) x = w * .225f;
        matrix.setTranslate(x, 0);
        light.setLocalMatrix(matrix);
        paint.setShader(light);
        canvas.drawRoundRect(0, top, w, top + thickness, thickness, thickness, paint);
        paint.setShader(null);
    }
}
