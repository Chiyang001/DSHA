package app.dsh.android;

import android.content.Context;
import android.os.Build;
import android.os.Environment;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.view.WindowManager;
import java.security.MessageDigest;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

final class BridgeServer {
    private final Context context;
    private final AdbClient adb;
    private final ShizukuClient shizuku;
    private final String token;
    volatile boolean controlEnabled = false;
    volatile boolean shellEnabled = false;

    BridgeServer(Context context, AdbClient adb, ShizukuClient shizuku, String token) {
        this.context = context.getApplicationContext();
        this.adb = adb;
        this.shizuku = shizuku;
        this.token = token;
    }

    void start() {
        new Thread(() -> {
            try (ServerSocket server = new ServerSocket(3981, 16, InetAddress.getByName("127.0.0.1"))) {
                while (true) {
                    Socket socket = server.accept();
                    new Thread(() -> handle(socket), "dsh-bridge-call").start();
                }
            } catch (Exception error) {
                android.util.Log.e("DSHAndroid", "Bridge failed", error);
            }
        }, "dsh-bridge").start();
    }

    private void handle(Socket socket) {
        try {
            Socket connection = socket;
            connection.setSoTimeout(30000);
            InputStream in = connection.getInputStream();
            ByteArrayOutputStream headers = new ByteArrayOutputStream();
            int b;
            while ((b = in.read()) != -1) {
                headers.write(b);
                if (headers.size() > 8192) throw new IllegalArgumentException("请求头过大");
                byte[] bytes = headers.toByteArray();
                int length = bytes.length;
                if (length >= 4 && bytes[length - 4] == '\r' && bytes[length - 3] == '\n'
                    && bytes[length - 2] == '\r' && bytes[length - 1] == '\n') break;
            }
            String head = headers.toString("UTF-8");
            if (!head.startsWith("POST /rpc HTTP/1.")) {
                reply(connection, 404, new JSONObject().put("error", "not_found"));
                return;
            }
            int length = -1;
            boolean authorized = false;
            for (String line : head.split("\r\n")) {
                String lower = line.toLowerCase(java.util.Locale.ROOT);
                if (lower.startsWith("content-length:")) length = Integer.parseInt(line.substring(15).trim());
                if (lower.startsWith("x-bridge-token:")) authorized = token.equals(line.substring(15).trim());
            }
            if (!authorized) {
                reply(connection, 403, new JSONObject().put("error", "unauthorized"));
                return;
            }
            if (length < 0 || length > 65536) throw new IllegalArgumentException("请求体大小无效");
            byte[] body = new byte[length];
            int offset = 0;
            while (offset < length) {
                int count = in.read(body, offset, length - offset);
                if (count < 0) throw new IllegalArgumentException("请求体不完整");
                offset += count;
            }
            JSONObject request = new JSONObject(new String(body, StandardCharsets.UTF_8));
            JSONObject result = dispatch(request);
            reply(connection, 200, result);
        } catch (Exception error) {
            android.util.Log.e("DSHAndroid", "Bridge request failed", error);
            try {
                reply(socket, 400, new JSONObject().put("error", error.getMessage() == null ? "unknown" : error.getMessage()));
            } catch (Exception ignored) { }
        } finally {
            try { socket.close(); } catch (Exception ignored) { }
        }
    }

    private JSONObject dispatch(JSONObject request) throws Exception {
        String method = request.optString("method", "");
        if ("progress".equals(method)) {
            String session = request.optString("session", "runtime");
            String text = request.optString("text", "处理中");
            if (session.length() > 128 || text.length() > 240) throw new IllegalArgumentException("状态过长");
            HarnessMonitorService.progress(session, text, request.optBoolean("active", true));
            return new JSONObject().put("ok", true);
        }
        if ("status".equals(method)) return new JSONObject()
            .put("connected", shizuku.isReady() || adb.isConnected())
            .put("transport", shizuku.isReady() ? "shizuku" : adb.isConnected() ? "wireless-adb" : "none")
            .put("controlEnabled", controlEnabled)
            .put("shellEnabled", shellEnabled)
            .put("device", Build.MANUFACTURER + " " + Build.MODEL)
            .put("android", Build.VERSION.RELEASE);
        if ("storageStatus".equals(method)) return storageStatus();
        if ("resolveHost".equals(method)) {
            String host = request.getString("hostname");
            if (!host.matches("[A-Za-z0-9.-]{1,253}")) throw new IllegalArgumentException("无效主机名");
            android.net.ConnectivityManager connectivity = (android.net.ConnectivityManager)
                context.getSystemService(Context.CONNECTIVITY_SERVICE);
            android.net.Network network = connectivity.getActiveNetwork();
            java.net.InetAddress[] resolved = network == null
                ? java.net.InetAddress.getAllByName(host) : network.getAllByName(host);
            JSONArray addresses = new JSONArray();
            for (java.net.InetAddress address : resolved) addresses.put(new JSONObject()
                .put("address", address.getHostAddress())
                .put("family", address instanceof java.net.Inet6Address ? 6 : 4));
            return new JSONObject().put("addresses", addresses);
        }
        if ("activateKernel".equals(method)) {
            NodeRuntime.activateKernel(context, request.getString("path"));
            return new JSONObject().put("restarting", true);
        }
        if ("androidSettings".equals(method)) return androidSettings();
        if ("updateAndroidSettings".equals(method)) {
            synchronized (this) {
                boolean control = request.has("controlEnabled") ? request.getBoolean("controlEnabled") : controlEnabled;
                boolean shell = request.has("shellEnabled") ? request.getBoolean("shellEnabled") : shellEnabled;
                if (!context.getSharedPreferences("dsh_setup", 0).edit()
                    .putBoolean("control", control).putBoolean("shell", shell).commit())
                    throw new IllegalStateException("设置保存失败，请重试");
                controlEnabled = control;
                shellEnabled = shell;
            }
            return androidSettings();
        }
        if ("requestShizuku".equals(method)) {
            runOnMain(() -> shizuku.request());
            return androidSettings();
        }
        if ("openStorageSettings".equals(method)) {
            runOnMain(() -> {
                android.content.Intent intent = new android.content.Intent(
                    android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    android.net.Uri.parse("package:" + context.getPackageName()));
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                try { context.startActivity(intent); }
                catch (android.content.ActivityNotFoundException ignored) {
                    context.startActivity(new android.content.Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
                        .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
                }
            });
            return androidSettings();
        }
        if ("openTextFile".equals(method)) {
            String path = request.getString("path");
            if (path.isEmpty() || path.length() > 4096) throw new IllegalArgumentException("路径无效");
            runOnMain(() -> openTextFile(path));
            return new JSONObject().put("ok", true);
        }
        if ("listDirectory".equals(method)) return listDirectory(request);
        if (!shizuku.isReady() && !adb.isConnected())
            throw new IllegalStateException("请先在应用内完成 Shizuku 一键授权");
        if (!controlEnabled) throw new IllegalStateException("请在应用内开启“允许 Harness 控制手机”");
        if ("displays".equals(method)) return new JSONObject().put("displays", shizuku.displays());
        int displayId = request.has("displayId") ? bounded(request, "displayId", 0, Integer.MAX_VALUE) : 0;
        if (displayId != 0) displayInfo(displayId); // Never fall back to the main display.
        if (request.has("expectedRotation") && request.getInt("expectedRotation") != screenRotation(displayId))
            throw new IllegalStateException("SCREEN_ROTATED: 请重新截图，未发送操作");
        String command;
        switch (method) {
            case "tap":
                command = "input -d " + displayId + " tap " + coordinate(request, "x") + " " + coordinate(request, "y");
                break;
            case "swipe":
                command = "input -d " + displayId + " swipe " + coordinate(request, "x1") + " " + coordinate(request, "y1")
                    + " " + coordinate(request, "x2") + " " + coordinate(request, "y2")
                    + " " + bounded(request, "duration", 1, 5000);
                break;
            case "key":
                if (displayId != 0 && (request.getInt("keycode") == 3 || request.getInt("keycode") == 26
                        || request.getInt("keycode") == 187))
                    throw new IllegalArgumentException("副屏模式不发送 Home、电源或最近任务键，避免切回主屏");
                command = "input -d " + displayId + " keyevent " + bounded(request, "keycode", 0, 300);
                break;
            case "text":
                String value = request.getString("text");
                if (value.length() > 128 || !value.matches("[\\x20-\\x7E]*"))
                    throw new IllegalArgumentException("ADB input text 仅支持 128 字以内的 ASCII 文本");
                command = "input -d " + displayId + " text " + quote(value.replace(" ", "%s"));
                break;
            case "ui":
                if (displayId != 0) throw new IllegalStateException("副屏请使用截图操作，uiautomator 无法保证目标屏幕");
                command = "uiautomator dump /data/local/tmp/dsh-ui.xml >/dev/null && cat /data/local/tmp/dsh-ui.xml";
                break;
            case "screenshot":
                return captureScreenshot(request);
            case "screen":
                if (displayId != 0) throw new IllegalStateException("副屏请使用 android_screenshot，避免读取主屏 UI");
                return captureScreenAnalysis();
            case "launch":
                String packageName = request.getString("package");
                if (!packageName.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+"))
                    throw new IllegalArgumentException("无效应用包名");
                command = "am start --display " + displayId + (displayId == 0 ? "" : " -f 0x18000000")
                    + " -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p " + quote(packageName);
                break;
            case "shell":
                if (displayId != 0) throw new IllegalStateException("副屏模式禁止任意 shell，避免未指定屏幕的命令操作主屏；请用 android_launch_app 和专用操作工具");
                if (!shellEnabled) throw new IllegalStateException("任意 shell 命令未获应用内授权");
                command = request.getString("command");
                if (command.length() > 2048 || command.isEmpty()) throw new IllegalArgumentException("命令长度无效");
                break;
            default:
                throw new IllegalArgumentException("未知方法：" + method);
        }
        long started = android.os.SystemClock.elapsedRealtime();
        String marker = "\n__DSH_EXIT_" + java.util.UUID.randomUUID().toString() + ":";
        String checked = "/system/bin/sh -c " + quote(command) + "; dsh_result=$?; printf "
            + quote(marker + "%s\\n") + " \"$dsh_result\"";
        byte[] output = execute(checked, method.equals("ui") ? 2 * 1024 * 1024 : 256 * 1024);
        String text = new String(output, StandardCharsets.UTF_8);
        int end = text.lastIndexOf(marker);
        if (end < 0) throw new IllegalStateException("COMMAND_OUTCOME_UNKNOWN: 未收到命令退出状态，请先检查手机，不要重复操作");
        int exitCode = Integer.parseInt(text.substring(end + marker.length()).trim());
        return new JSONObject().put("ok", exitCode == 0).put("exitCode", exitCode)
            .put("output", text.substring(0, end))
            .put("displayId", displayId)
            .put("transport", shizuku.isReady() ? "shizuku" : "wireless-adb")
            .put("durationMs", android.os.SystemClock.elapsedRealtime() - started);
    }

    private int screenRotation() {
        return context.getSystemService(WindowManager.class).getDefaultDisplay().getRotation();
    }

    private JSONObject displayInfo(int id) throws Exception {
        JSONArray displays = shizuku.displays();
        for (int i = 0; i < displays.length(); i++) {
            JSONObject display = displays.getJSONObject(i);
            if (display.getInt("displayId") == id) return display;
        }
        throw new IllegalStateException("DISPLAY_UNAVAILABLE: 指定副屏已关闭或不存在，未操作主屏");
    }

    private int screenRotation(int id) throws Exception {
        return id == 0 ? screenRotation() : displayInfo(id).getInt("rotation");
    }

    private JSONObject captureScreenshot(JSONObject request) throws Exception {
        int displayId = request.has("displayId") ? bounded(request, "displayId", 0, Integer.MAX_VALUE) : 0;
        final JSONObject[] result = new JSONObject[1];
        HarnessMonitorService.runWithoutOverlay(() -> {
            result[0] = writeScreenshotPng(displayId == 0 ? execute("screencap -p", 12 * 1024 * 1024)
                : shizuku.captureDisplay(displayId));
            result[0].put("displayId", displayId).put("rotation", screenRotation(displayId));
            if (request.optBoolean("fast", false)) prepareFastScreenshot(result[0], request);
        });
        return result[0];
    }

    private void prepareFastScreenshot(JSONObject result, JSONObject request) throws Exception {
        Bitmap original = BitmapFactory.decodeFile(result.getString("path"));
        if (original == null) throw new IllegalStateException("截图解码失败");
        Bitmap sample = null, crop = null, preview = null;
        try {
            int width = original.getWidth(), height = original.getHeight();
            sample = Bitmap.createScaledBitmap(original, 24, 48, true);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            // Ignore status/navigation strips; quantize colors to reduce noise.
            for (int y = 3; y < 45; y++) for (int x = 0; x < 24; x++) {
                int color = sample.getPixel(x, y);
                digest.update((byte) ((color >> 19) & 31));
                digest.update((byte) ((color >> 11) & 31));
                digest.update((byte) ((color >> 3) & 31));
            }
            StringBuilder hash = new StringBuilder();
            for (byte value : digest.digest()) hash.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
            int left = request.optInt("crop_x", 0), top = request.optInt("crop_y", 0);
            int cw = request.optInt("crop_width", width), ch = request.optInt("crop_height", height);
            if (left < 0 || top < 0 || cw <= 0 || ch <= 0 || (long) left + cw > width || (long) top + ch > height)
                throw new IllegalArgumentException("裁剪区域超出截图边界");
            crop = Bitmap.createBitmap(original, left, top, cw, ch);
            // <=30x30 visual cells (42 px each), within the current image budget.
            double scale = 1260.0 / Math.max(cw, ch);
            int vw = Math.max(1, (int) Math.round(cw * scale)), vh = Math.max(1, (int) Math.round(ch * scale));
            // Full screens are never enlarged; requested crops can be enlarged.
            if (cw == width && ch == height && scale > 1) { vw = cw; vh = ch; }
            preview = Bitmap.createScaledBitmap(crop, vw, vh, true);
            String path = result.getString("path").replace(".png", "-view.png");
            try (FileOutputStream out = new FileOutputStream(path)) {
                if (!preview.compress(Bitmap.CompressFormat.PNG, 100, out)) throw new IllegalStateException("截图编码失败");
            }
            result.put("viewPath", path).put("viewWidth", vw).put("viewHeight", vh)
                .put("cropLeft", left).put("cropTop", top).put("cropWidth", cw).put("cropHeight", ch)
                .put("fingerprint", hash.toString());
        } finally {
            if (preview != null && preview != crop && preview != original) preview.recycle();
            if (crop != null && crop != original) crop.recycle();
            if (sample != null && sample != original) sample.recycle();
            original.recycle();
        }
    }

    private JSONObject captureScreenAnalysis() throws Exception {
        final JSONObject[] result = new JSONObject[1];
        HarnessMonitorService.runWithoutOverlay(() -> {
            try {
                byte[] png = execute("screencap -p", 12 * 1024 * 1024);
                JSONObject screenshot = writeScreenshotPng(png);
                String uiXml;
                try {
                    uiXml = new String(execute(
                        "uiautomator dump /data/local/tmp/dsh-ui.xml >/dev/null && cat /data/local/tmp/dsh-ui.xml",
                        2 * 1024 * 1024), StandardCharsets.UTF_8);
                } catch (Exception error) {
                    android.util.Log.w("DSHAndroid", "UI dump failed during screen analysis", error);
                    uiXml = "";
                }
                JSONArray ocr;
                try {
                    ocr = ScreenOcr.recognizeLines(png);
                } catch (Exception error) {
                    android.util.Log.w("DSHAndroid", "OCR failed during screen analysis", error);
                    ocr = new JSONArray();
                }
                result[0] = screenshot.put("uiXml", uiXml).put("ocr", ocr);
            } catch (Exception error) {
                throw new RuntimeException(error);
            }
        });
        return result[0];
    }

    private JSONObject writeScreenshotPng(byte[] png) throws Exception {
        if (png.length < 24 || png[0] != (byte) 0x89 || png[1] != 'P' || png[2] != 'N' || png[3] != 'G')
            throw new IllegalStateException("截图未返回 PNG 数据");
        int width = pngDimension(png, 16);
        int height = pngDimension(png, 20);
        if (width <= 0 || height <= 0) throw new IllegalStateException("截图尺寸无效");
        File shots = new File(context.getNoBackupFilesDir(), "screenshots");
        if (!shots.exists() && !shots.mkdirs()) throw new IllegalStateException("无法创建截图目录");
        File file = new File(shots, "dsh-screen-" + System.currentTimeMillis() + "-" + System.nanoTime() + ".png");
        try (FileOutputStream out = new FileOutputStream(file)) { out.write(png); }
        return new JSONObject()
            .put("path", file.getAbsolutePath())
            .put("rotation", screenRotation())
            .put("width", width)
            .put("height", height);
    }

    private static int pngDimension(byte[] png, int offset) {
        return ((png[offset] & 0xff) << 24) | ((png[offset + 1] & 0xff) << 16)
            | ((png[offset + 2] & 0xff) << 8) | (png[offset + 3] & 0xff);
    }

    private JSONObject storageStatus() throws Exception {
        return new JSONObject()
            .put("granted", Build.VERSION.SDK_INT < Build.VERSION_CODES.R
                || Environment.isExternalStorageManager())
            .put("storageRoot", Environment.getExternalStorageDirectory().getAbsolutePath());
    }

    private JSONObject androidSettings() throws Exception {
        return storageStatus()
            .put("shizukuConnected", shizuku.isReady())
            .put("shizukuStatus", shizuku.statusMessage())
            .put("controlEnabled", controlEnabled)
            .put("shellEnabled", shellEnabled);
    }

    private void runOnMain(Runnable action) throws Exception {
        java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.atomic.AtomicReference<RuntimeException> failure = new java.util.concurrent.atomic.AtomicReference<>();
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
            try { action.run(); } catch (RuntimeException error) { failure.set(error); }
            finally { done.countDown(); }
        });
        if (!done.await(5, java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException("设置操作超时，请重试");
        if (failure.get() != null) throw failure.get();
    }

    private JSONObject listDirectory(JSONObject request) throws Exception {
        String dirPath = request.getString("path");
        if (dirPath.isEmpty() || dirPath.length() > 4096) throw new IllegalArgumentException("路径无效");
        File dir = new File(dirPath).getCanonicalFile();
        if (!dir.exists()) throw new IllegalStateException("目录不存在：" + dirPath);
        if (!dir.isDirectory()) throw new IllegalStateException("不是目录：" + dirPath);
        JSONArray entries = listEntriesViaJava(dir);
        if ((entries == null || (entries.length() == 0 && isSharedStorage(dir.getAbsolutePath())))
            && (shizuku.isReady() || adb.isConnected())) {
            JSONArray shellEntries = listEntriesViaShell(dir);
            if (shellEntries != null && shellEntries.length() > 0) entries = shellEntries;
        }
        if (entries == null) {
            if (isSharedStorage(dir.getAbsolutePath())
                && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                && !Environment.isExternalStorageManager()) {
                throw new IllegalStateException("需要授予“所有文件访问”权限才能浏览内部存储");
            }
            throw new IllegalStateException("无法读取目录：" + dir.getAbsolutePath());
        }
        return new JSONObject()
            .put("path", dir.getAbsolutePath())
            .put("entries", entries)
            .put("truncated", entries.length() >= 1000);
    }

    private JSONArray listEntriesViaJava(File dir) throws Exception {
        String[] names = dir.list();
        if (names == null) return null;
        java.util.Arrays.sort(names, String::compareToIgnoreCase);
        JSONArray entries = new JSONArray();
        for (String name : names) {
            File child = new File(dir, name);
            if (!child.isDirectory()) continue;
            if (entries.length() >= 1000) break;
            String childPath;
            try {
                childPath = child.getCanonicalPath();
            } catch (Exception ignored) {
                childPath = child.getAbsolutePath();
            }
            entries.put(new JSONObject()
                .put("name", name)
                .put("path", childPath)
                .put("hidden", name.startsWith(".")));
        }
        return entries;
    }

    private JSONArray listEntriesViaShell(File dir) throws Exception { // JSONException included
        if (!shizuku.isReady() && !adb.isConnected()) return null;
        String path = dir.getAbsolutePath();
        byte[] raw = execute("ls -1p " + shellQuote(path), 512 * 1024);
        String text = new String(raw, StandardCharsets.UTF_8).trim();
        if (text.isEmpty()) return new JSONArray();
        JSONArray entries = new JSONArray();
        for (String line : text.split("\n")) {
            line = line.trim();
            if (line.isEmpty() || !line.endsWith("/")) continue;
            String name = line.substring(0, line.length() - 1);
            if (name.equals(".") || name.equals("..")) continue;
            if (entries.length() >= 1000) break;
            File child = new File(dir, name);
            entries.put(new JSONObject()
                .put("name", name)
                .put("path", child.getAbsolutePath())
                .put("hidden", name.startsWith(".")));
        }
        return entries;
    }

    private static String shellQuote(String text) {
        return "'" + text.replace("'", "'\\''") + "'";
    }

    private static boolean isSharedStorage(String path) {
        return path.startsWith("/storage/") || path.startsWith("/sdcard");
    }

    private byte[] execute(String command, int maxBytes) throws Exception {
        return shizuku.isReady() ? shizuku.execute(command, maxBytes) : adb.execute(command, maxBytes);
    }

    private static int coordinate(JSONObject data, String name) throws Exception {
        return bounded(data, name, 0, 10000);
    }

    private static int bounded(JSONObject data, String name, int min, int max) throws Exception {
        double value = data.getDouble(name);
        if (!Double.isFinite(value) || value != Math.rint(value) || value < min || value > max)
            throw new IllegalArgumentException(name + " 必须是范围内的整数");
        return (int) value;
    }

    private static String quote(String text) { return "'" + text.replace("'", "'\\''") + "'"; }

    private void openTextFile(String pathStr) {
        try {
            File source = new File(pathStr).getCanonicalFile();
            if (!isAllowedDocumentPath(source)) throw new SecurityException("不允许打开该路径：" + pathStr);
            if (!source.isFile()) throw new IllegalStateException("配置文件不存在");
            File sharedDir = new File(context.getCacheDir(), "shared-documents");
            if (!sharedDir.exists() && !sharedDir.mkdirs()) throw new IllegalStateException("无法创建共享目录");
            File shared = new File(sharedDir, source.getName());
            java.nio.file.Files.copy(source.toPath(), shared.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            android.net.Uri uri = androidx.core.content.FileProvider.getUriForFile(
                context, context.getPackageName() + ".files", shared);
            launchDocumentViewer(uri, "text/plain");
        } catch (RuntimeException error) {
            android.util.Log.e("DSHAndroid", "openTextFile failed for " + pathStr, error);
            throw error;
        } catch (Exception error) {
            android.util.Log.e("DSHAndroid", "openTextFile failed for " + pathStr, error);
            throw new IllegalStateException("无法打开配置文件：" + error.getMessage(), error);
        }
    }

    private void launchDocumentViewer(android.net.Uri uri, String mimeType) {
        android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
        intent.setDataAndType(uri, mimeType);
        intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
            | android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
        android.content.Intent chooser = android.content.Intent.createChooser(intent, "打开配置文件");
        chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(chooser);
        } catch (android.content.ActivityNotFoundException error) {
            if ("*/*".equals(mimeType)) throw error;
            launchDocumentViewer(uri, "*/*");
        }
    }

    private boolean isAllowedDocumentPath(File file) throws Exception {
        String path = file.getCanonicalPath();
        String noBackup = context.getNoBackupFilesDir().getCanonicalPath();
        String files = context.getFilesDir().getCanonicalPath();
        String cache = context.getCacheDir().getCanonicalPath();
        if (path.startsWith(noBackup) || path.startsWith(files) || path.startsWith(cache)) return true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()) {
            String storage = Environment.getExternalStorageDirectory().getCanonicalPath();
            return path.startsWith(storage);
        }
        return false;
    }

    private static void reply(Socket socket, int status, JSONObject json) throws Exception {
        byte[] body = json.toString().getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + status + (status == 200 ? " OK" : " Error") + "\r\n"
            + "Content-Type: application/json; charset=utf-8\r\n"
            + "Content-Length: " + body.length + "\r\nConnection: close\r\n\r\n";
        OutputStream out = socket.getOutputStream();
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }
}
