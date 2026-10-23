package com.p1ziyu.riichitracker.p1

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Binary format: version byte, 12-byte random nonce, authenticated ciphertext + tag. */
class TokenCipher(private val key: SecretKey) {
    fun seal(token: String): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val ciphertext = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        val nonce = cipher.iv
        check(nonce.size == 12) { "Invalid GCM nonce length" }
        return byteArrayOf(1) + nonce + ciphertext
    }

    fun open(bytes: ByteArray): String {
        require(bytes.size >= 30 && bytes[0] == 1.toByte()) { "Invalid encrypted token" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
        return cipher.doFinal(bytes.copyOfRange(13, bytes.size)).toString(Charsets.UTF_8)
    }
}

class TokenStore(context: Context) {
    private val file = AtomicFile(File(context.filesDir, "auth-token.bin"))
    private val alias = "ichihime-p1-session"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }

    fun load(): String? {
        if (!file.baseFile.exists()) return null
        return try { TokenCipher(key()).open(file.readFully()).takeIf { it.isNotEmpty() } }
        catch (_: Exception) {
            clear()
            // A corrupted file or invalidated hardware key must never revive a stale session.
            runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(alias) }
            null
        }
    }

    fun save(token: String) {
        require(token.isNotBlank())
        val bytes = TokenCipher(key()).seal(token)
        val stream = file.startWrite()
        try { stream.write(bytes); file.finishWrite(stream) }
        catch (error: Exception) { file.failWrite(stream); throw error }
    }

    fun clear() { file.delete() }
}
