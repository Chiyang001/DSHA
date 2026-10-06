package app.dsh.android;

import android.content.Context;
import android.os.Build;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.math.BigInteger;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Date;
import java.util.concurrent.TimeUnit;
import org.bouncycastle.asn1.x500.X500Name;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder;
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder;
import io.github.muntashirakon.adb.AbsAdbConnectionManager;
import io.github.muntashirakon.adb.AdbStream;

final class AdbClient extends AbsAdbConnectionManager {
    private final PrivateKey key;
    private final Certificate certificate;
    private final Context context;

    AdbClient(Context context) throws Exception {
        this.context = context.getApplicationContext();
        setApi(Build.VERSION.SDK_INT);
        setTimeout(15, TimeUnit.SECONDS);
        File dir = this.context.getNoBackupFilesDir();
        File keyFile = new File(dir, "adb-private.pk8");
        File certFile = new File(dir, "adb-cert.der");
        if (!keyFile.exists() || !certFile.exists()) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048, new SecureRandom());
            KeyPair pair = generator.generateKeyPair();
            X500Name subject = new X500Name("CN=DeepSeek Harness Android");
            Date from = new Date(System.currentTimeMillis() - 60000);
            Date to = new Date(System.currentTimeMillis() + 20L * 365 * 86400000);
            JcaX509v3CertificateBuilder builder = new JcaX509v3CertificateBuilder(
                subject, BigInteger.valueOf(System.currentTimeMillis()), from, to,
                subject, pair.getPublic());
            Certificate generated = new JcaX509CertificateConverter().getCertificate(
                builder.build(new JcaContentSignerBuilder("SHA256withRSA").build(pair.getPrivate())));
            try (FileOutputStream out = new FileOutputStream(keyFile)) { out.write(pair.getPrivate().getEncoded()); }
            try (FileOutputStream out = new FileOutputStream(certFile)) { out.write(generated.getEncoded()); }
        }
        try (FileInputStream in = new FileInputStream(keyFile)) {
            byte[] data = readAll(in, 8192);
            key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(data));
        }
        try (FileInputStream in = new FileInputStream(certFile)) {
            certificate = CertificateFactory.getInstance("X.509").generateCertificate(in);
        }
    }

    @Override protected PrivateKey getPrivateKey() { return key; }
    @Override protected Certificate getCertificate() { return certificate; }
    @Override protected String getDeviceName() { return "DeepSeek Harness Android"; }

    byte[] execute(String command, int maxBytes) throws Exception {
        if (!isConnected()) throw new IllegalStateException("无线 ADB 尚未连接");
        AdbStream stream = openStream("exec:" + command);
        try (InputStream in = stream.openInputStream()) {
            return readAll(in, maxBytes);
        } finally {
            stream.close();
        }
    }

    static byte[] readAll(InputStream in, int maxBytes) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = in.read(buffer)) != -1) {
            if (out.size() + count > maxBytes) throw new IllegalStateException("ADB 输出过大");
            out.write(buffer, 0, count);
        }
        return out.toByteArray();
    }
}
