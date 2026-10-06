package app.dsh.android;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.Shader;

/** Quiet ambient light and a distant moving particle horizon. */
final class AnimatedBackgroundView extends AmbientAnimationView {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private Shader glow;
    private final float density;
    AnimatedBackgroundView(Context context) {
        super(context);
        density = context.getResources().getDisplayMetrics().density;
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }
    @Override protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        if (w > 0 && h > 0) glow = new RadialGradient(w * .5f, h * .43f,
            Math.max(w * .8f, h * .45f), new int[] {0xFF122035, 0xFF0D131D, UiKit.BG},
            new float[] {0, .48f, 1}, Shader.TileMode.CLAMP);
    }
    @Override protected void onDraw(Canvas canvas) {
        float w = getWidth(), h = getHeight();
        canvas.drawColor(UiKit.BG);
        paint.setShader(glow);
        paint.setAlpha(255);
        canvas.drawRect(0, 0, w, h, paint);
        paint.setShader(null);
        float spacing = 22 * density;
        int columns = (int) (w / spacing) + 1;
        for (int row = 0; row < 13; row++) {
            float depth = row / 12f;
            for (int col = 0; col <= columns; col++) {
                float u = col / (float) Math.max(1, columns);
                float wave = (float) Math.sin(u * Math.PI * 2 + seconds * .24f + depth * 2.5f);
                float y = h * .76f + depth * h * .21f + wave * density * (6 + depth * 10);
                float fade = (float) Math.sin(depth * Math.PI) * (float) Math.sin(u * Math.PI);
                paint.setColor(0xFF86A8CD);
                paint.setAlpha((int) (fade * 42));
                canvas.drawCircle(u * w, y, density * (.65f + depth * .25f), paint);
            }
        }
        paint.setAlpha(255);
    }
}
