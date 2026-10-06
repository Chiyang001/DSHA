package app.dsh.android;

import android.animation.ValueAnimator;
import android.content.Context;
import android.view.Choreographer;
import android.view.View;

/** Canvas animation that stops offscreen and follows the display's actual frame clock. */
abstract class AmbientAnimationView extends View implements Choreographer.FrameCallback {
    protected float seconds;
    private boolean running;
    private long lastFrame;
    AmbientAnimationView(Context context) { super(context); }
    @Override public void onVisibilityAggregated(boolean visible) {
        super.onVisibilityAggregated(visible);
        stopFrames();
        if (visible && ValueAnimator.areAnimatorsEnabled()) {
            running = true;
            Choreographer.getInstance().postFrameCallback(this);
        }
        invalidate();
    }
    @Override protected void onDetachedFromWindow() {
        stopFrames();
        super.onDetachedFromWindow();
    }
    private void stopFrames() {
        running = false;
        lastFrame = 0;
        Choreographer.getInstance().removeFrameCallback(this);
    }
    @Override public void doFrame(long frameTimeNanos) {
        if (!running) return;
        if (!ValueAnimator.areAnimatorsEnabled()) { stopFrames(); return; }
        if (lastFrame != 0) seconds += Math.min(.05f, (frameTimeNanos - lastFrame) / 1_000_000_000f);
        lastFrame = frameTimeNanos;
        invalidate();
        Choreographer.getInstance().postFrameCallback(this);
    }
}
