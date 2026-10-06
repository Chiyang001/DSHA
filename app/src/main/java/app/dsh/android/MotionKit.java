package app.dsh.android;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;

/** Lightweight view transition helpers. */
final class MotionKit {
    private MotionKit() {}

    static void reveal(View view, long durationMs) {
        view.setVisibility(View.VISIBLE);
        view.setAlpha(0f);
        view.setScaleX(0.94f);
        view.setScaleY(0.94f);
        view.setTranslationY(UiKit.dp(view.getContext(), 18));
        view.animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .translationY(0f)
            .setDuration(durationMs)
            .setInterpolator(new OvershootInterpolator(0.85f))
            .start();
    }

    static void dismiss(View view, long durationMs, Runnable end) {
        if (view.getVisibility() != View.VISIBLE) {
            if (end != null) end.run();
            return;
        }
        view.animate()
            .alpha(0f)
            .scaleX(0.96f)
            .scaleY(0.96f)
            .translationY(UiKit.dp(view.getContext(), -12))
            .setDuration(durationMs)
            .setInterpolator(new DecelerateInterpolator())
            .setListener(new AnimatorListenerAdapter() {
                @Override public void onAnimationEnd(Animator animation) {
                    view.setVisibility(View.GONE);
                    view.setAlpha(1f);
                    view.setScaleX(1f);
                    view.setScaleY(1f);
                    view.setTranslationY(0f);
                    view.animate().setListener(null);
                    if (end != null) end.run();
                }
            })
            .start();
    }

    static void crossfade(View from, View to, long outMs, long inMs, Runnable beforeShow) {
        if (from == to) return;
        Runnable show = () -> {
            if (beforeShow != null) beforeShow.run();
            reveal(to, inMs);
        };
        if (from != null && from.getVisibility() == View.VISIBLE) {
            dismiss(from, outMs, show);
        } else {
            show.run();
        }
    }

    static void wizardStepChange(View card, boolean forward, Runnable update) {
        float shift = UiKit.dp(card.getContext(), 36);
        card.animate()
            .alpha(0f)
            .translationX(forward ? -shift : shift)
            .setDuration(160)
            .setInterpolator(new DecelerateInterpolator())
            .withEndAction(() -> {
                update.run();
                card.setTranslationX(forward ? shift : -shift);
                card.animate()
                    .alpha(1f)
                    .translationX(0f)
                    .setDuration(240)
                    .setInterpolator(new DecelerateInterpolator(1.6f))
                    .start();
            })
            .start();
    }

    static void staggerIn(View[] views, long delayMs) {
        for (int i = 0; i < views.length; i++) {
            View view = views[i];
            view.setAlpha(0f);
            view.setTranslationY(UiKit.dp(view.getContext(), 14));
            view.animate()
                .alpha(1f)
                .translationY(0f)
                .setStartDelay(i * delayMs)
                .setDuration(280)
                .setInterpolator(new DecelerateInterpolator(1.4f))
                .start();
        }
    }

    static ValueAnimator floatAnim(long durationMs, ValueAnimator.AnimatorUpdateListener listener) {
        ValueAnimator animator = ValueAnimator.ofFloat(0f, 1f);
        animator.setDuration(durationMs);
        animator.setRepeatCount(ValueAnimator.INFINITE);
        animator.setRepeatMode(ValueAnimator.REVERSE);
        animator.addUpdateListener(listener);
        animator.start();
        return animator;
    }
}
