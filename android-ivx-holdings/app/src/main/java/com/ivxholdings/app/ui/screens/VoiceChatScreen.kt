package com.ivxholdings.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.ivxholdings.app.ui.theme.IVXBlue
import com.ivxholdings.app.ui.theme.IVXDark
import com.ivxholdings.app.ui.theme.IVXGold
import com.ivxholdings.app.ui.theme.IVXGreen
import com.ivxholdings.app.ui.theme.IVXOnSurface
import com.ivxholdings.app.ui.theme.IVXOnSurfaceMuted
import com.ivxholdings.app.ui.theme.IVXRed
import com.ivxholdings.app.ui.theme.IVXSurfaceVariant
import com.ivxholdings.app.ui.viewmodel.VoiceChatEntry
import com.ivxholdings.app.ui.viewmodel.VoiceChatViewModel
import org.koin.androidx.compose.koinViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VoiceChatScreen(navController: NavController) {
    val viewModel: VoiceChatViewModel = koinViewModel()
    val state by viewModel.state.collectAsState()
    var textInput by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("IVX Voice Chat") },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = IVXOnSurface)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = IVXDark)
            )
        },
        containerColor = IVXDark
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            LazyColumn(
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(state.conversations) { entry ->
                    VoiceMessageBubble(entry)
                }
                if (state.isProcessing) {
                    item {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.Center
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(28.dp),
                                color = IVXGold,
                                strokeWidth = 2.dp
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Text("Processing with AI...", color = IVXOnSurfaceMuted, fontSize = 14.sp)
                        }
                    }
                }
                state.error?.let { err ->
                    item {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = IVXRed.copy(alpha = 0.12f)),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Text(
                                err,
                                color = IVXRed,
                                fontSize = 13.sp,
                                modifier = Modifier.padding(12.dp)
                            )
                        }
                    }
                }
            }

            // Mic button row
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Button(
                    onClick = {
                        viewModel.setRecording(!state.isRecording)
                    },
                    shape = CircleShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (state.isRecording) IVXRed else IVXGold,
                        contentColor = IVXDark
                    ),
                    modifier = Modifier.size(56.dp)
                ) {
                    Icon(
                        if (state.isRecording) Icons.Default.Stop else Icons.Default.Mic,
                        contentDescription = if (state.isRecording) "Stop" else "Record",
                        modifier = Modifier.size(24.dp)
                    )
                }
                Spacer(modifier = Modifier.width(12.dp))
                Text(
                    if (state.isRecording) "Recording..." else "Tap to speak",
                    color = IVXOnSurfaceMuted,
                    fontSize = 13.sp
                )
            }

            // Text input row
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = textInput,
                    onValueChange = { textInput = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Type to chat with AI voice...") },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = IVXSurfaceVariant,
                        unfocusedContainerColor = IVXSurfaceVariant,
                        focusedBorderColor = IVXGold,
                        unfocusedBorderColor = IVXOnSurfaceMuted
                    ),
                    singleLine = true
                )
                Spacer(modifier = Modifier.width(8.dp))
                Button(
                    onClick = {
                        viewModel.sendTextAsVoice(textInput)
                        textInput = ""
                    },
                    enabled = textInput.isNotBlank() && !state.isProcessing,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = IVXGold,
                        contentColor = IVXDark,
                        disabledContainerColor = IVXGold.copy(alpha = 0.4f)
                    )
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send")
                }
            }
        }
    }
}

@Composable
private fun VoiceMessageBubble(entry: VoiceChatEntry) {
    val isOwner = entry.role == "owner"
    val bgColor = if (isOwner) IVXBlue else IVXSurfaceVariant
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isOwner) Arrangement.End else Arrangement.Start
    ) {
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = bgColor)
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (!isOwner) {
                        Icon(Icons.Default.VolumeUp, contentDescription = null, tint = IVXGreen, modifier = Modifier.size(14.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                    }
                    Text(
                        if (isOwner) "YOU" else "IVX AI",
                        color = if (isOwner) IVXGold else IVXGreen,
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(entry.text, color = IVXOnSurface, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}
