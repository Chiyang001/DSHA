package app.dsh.android;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

final class ScreenOcr {
    private ScreenOcr() { }

    static JSONArray recognizeLines(byte[] pngBytes) throws Exception {
        Bitmap bitmap = BitmapFactory.decodeByteArray(pngBytes, 0, pngBytes.length);
        if (bitmap == null) throw new IllegalStateException("无法解码截图");
        InputImage image = InputImage.fromBitmap(bitmap, 0);
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<JSONArray> result = new AtomicReference<>(new JSONArray());
        AtomicReference<Exception> failure = new AtomicReference<>();
        TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build())
            .process(image)
            .addOnSuccessListener(text -> {
                try {
                    result.set(extractLines(text));
                } catch (Exception error) {
                    failure.set(error);
                } finally {
                    bitmap.recycle();
                    done.countDown();
                }
            })
            .addOnFailureListener(error -> {
                failure.set(new IllegalStateException("OCR 失败：" + error.getMessage(), error));
                bitmap.recycle();
                done.countDown();
            });
        if (!done.await(20, TimeUnit.SECONDS)) throw new IllegalStateException("OCR 超时，请重试");
        if (failure.get() != null) throw failure.get();
        return result.get();
    }

    private static JSONArray extractLines(Text text) throws Exception {
        JSONArray lines = new JSONArray();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                String value = line.getText() == null ? "" : line.getText().trim();
                if (value.isEmpty()) continue;
                Rect rect = line.getBoundingBox();
                if (rect == null || rect.width() < 10 || rect.height() < 10) continue;
                lines.put(new JSONObject()
                    .put("text", value)
                    .put("left", rect.left)
                    .put("top", rect.top)
                    .put("right", rect.right)
                    .put("bottom", rect.bottom));
            }
        }
        return lines;
    }
}
