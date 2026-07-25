package com.ivxholdings.app.ui.screens

import android.content.Intent
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.ivxholdings.app.upload.IVXUploadQueue
import com.ivxholdings.app.upload.UploadDraft

/** File picker that persists URI access, validates locally, then schedules unique resumable work. */
@Composable
fun UploadScreen() {
    val context = LocalContext.current
    var draft by remember { mutableStateOf<UploadDraft?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val mime = context.contentResolver.getType(uri).orEmpty()
            val metadata = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                require(cursor.moveToFirst()) { "Could not read selected file metadata." }
                (cursor.getString(0) ?: "upload") to cursor.getLong(1)
            } ?: error("Could not read selected file metadata.")
            val name = metadata.first
            val size = metadata.second
            require(size <= 500L * 1024L * 1024L) { "File is larger than the 500 MB mobile limit." }
            IVXUploadQueue(context).enqueue(uri, name, mime, size)
        }.onSuccess { draft = it; error = null }.onFailure { error = it.message ?: "This file cannot be uploaded." }
    }
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Media upload", style = MaterialTheme.typography.headlineMedium)
        Text("Uploads are queued persistently, use a unique idempotency key, and stream bytes from storage.", modifier = Modifier.padding(top = 10.dp), style = MaterialTheme.typography.bodyMedium)
        Button(modifier = Modifier.padding(top = 24.dp), onClick = { picker.launch(arrayOf("image/*", "video/*")) }) { Text("Choose photo or video") }
        draft?.let { Text("${it.displayName}\n${it.stage} • ${it.traceId}", modifier = Modifier.padding(top = 20.dp)) }
        error?.let { Text(it, modifier = Modifier.padding(top = 20.dp), color = MaterialTheme.colorScheme.error) }
    }
}
