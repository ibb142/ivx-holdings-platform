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
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Sms
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
import androidx.compose.ui.text.font.FontFamily
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
import com.ivxholdings.app.ui.viewmodel.SignalWireViewModel
import org.koin.androidx.compose.koinViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignalWireScreen(navController: NavController) {
    val viewModel: SignalWireViewModel = koinViewModel()
    val state by viewModel.state.collectAsState()
    var smsTo by remember { mutableStateOf(state.ownerPhone) }
    var smsBody by remember { mutableStateOf("") }
    var callTo by remember { mutableStateOf(state.ownerPhone) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("SignalWire Comms") },
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
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Quick actions
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Notifications, contentDescription = null, tint = IVXGold, modifier = Modifier.size(22.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Quick Owner Actions", color = IVXOnSurface, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                        }
                        Spacer(modifier = Modifier.height(16.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Button(
                                onClick = { viewModel.quickNotifyOwner("IVX Alert: Check the autonomous dashboard for updates.") },
                                enabled = !state.isSendingSMS,
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = IVXBlue, contentColor = IVXDark)
                            ) {
                                Icon(Icons.Default.Sms, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("SMS Owner", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                            }
                            Button(
                                onClick = { viewModel.quickCallOwner() },
                                enabled = !state.isMakingCall,
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = IVXGreen, contentColor = IVXDark)
                            ) {
                                Icon(Icons.Default.Call, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Call Owner", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }

            // SMS Card
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Sms, contentDescription = null, tint = IVXBlue, modifier = Modifier.size(22.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Send SMS", color = IVXOnSurface, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                        }
                        Spacer(modifier = Modifier.height(16.dp))
                        OutlinedTextField(
                            value = smsTo,
                            onValueChange = { smsTo = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("To (E.164)") },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedContainerColor = IVXDark,
                                unfocusedContainerColor = IVXDark,
                                focusedBorderColor = IVXGold,
                                unfocusedBorderColor = IVXOnSurfaceMuted
                            ),
                            singleLine = true
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        OutlinedTextField(
                            value = smsBody,
                            onValueChange = { smsBody = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Message") },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedContainerColor = IVXDark,
                                unfocusedContainerColor = IVXDark,
                                focusedBorderColor = IVXGold,
                                unfocusedBorderColor = IVXOnSurfaceMuted
                            ),
                            minLines = 2,
                            maxLines = 4
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Button(
                            onClick = { viewModel.sendSMS(smsTo, smsBody) },
                            enabled = !state.isSendingSMS && smsTo.isNotBlank() && smsBody.isNotBlank(),
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = IVXGold, contentColor = IVXDark)
                        ) {
                            if (state.isSendingSMS) {
                                CircularProgressIndicator(color = IVXDark, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Sending...")
                            } else {
                                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Send SMS", fontWeight = FontWeight.Bold)
                            }
                        }
                        state.smsResult?.let { result ->
                            Spacer(modifier = Modifier.height(12.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.CheckCircle, contentDescription = null, tint = IVXGreen, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("SID: ${result.sid}", color = IVXGreen, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                            }
                        }
                    }
                }
            }

            // Voice Call Card
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Phone, contentDescription = null, tint = IVXGreen, modifier = Modifier.size(22.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Voice Call", color = IVXOnSurface, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                        }
                        Spacer(modifier = Modifier.height(16.dp))
                        OutlinedTextField(
                            value = callTo,
                            onValueChange = { callTo = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("To (E.164)") },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedContainerColor = IVXDark,
                                unfocusedContainerColor = IVXDark,
                                focusedBorderColor = IVXGold,
                                unfocusedBorderColor = IVXOnSurfaceMuted
                            ),
                            singleLine = true
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Button(
                            onClick = { viewModel.makeVoiceCall(callTo) },
                            enabled = !state.isMakingCall && callTo.isNotBlank(),
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = IVXGreen, contentColor = IVXDark)
                        ) {
                            if (state.isMakingCall) {
                                CircularProgressIndicator(color = IVXDark, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Calling...")
                            } else {
                                Icon(Icons.Default.Call, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Place Call", fontWeight = FontWeight.Bold)
                            }
                        }
                        state.callResult?.let { result ->
                            Spacer(modifier = Modifier.height(12.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.CheckCircle, contentDescription = null, tint = IVXGreen, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("SID: ${result.sid}", color = IVXGreen, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                            }
                        }
                    }
                }
            }

            // Error display
            state.error?.let { err ->
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = IVXRed.copy(alpha = 0.12f)),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text(err, color = IVXRed, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
                    }
                }
            }

            // SMS History
            if (state.smsHistory.isNotEmpty()) {
                item {
                    Text("SMS History", color = IVXGold, fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.padding(top = 8.dp))
                }
                items(state.smsHistory) { entry ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
                    ) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            Text("To: ${entry.to}", color = IVXOnSurface, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                            Text(entry.body, color = IVXOnSurfaceMuted, fontSize = 12.sp)
                            Text("SID: ${entry.sid}", color = IVXGreen, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                        }
                    }
                }
            }

            // Call History
            if (state.callHistory.isNotEmpty()) {
                item {
                    Text("Call History", color = IVXGold, fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.padding(top = 8.dp))
                }
                items(state.callHistory) { entry ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
                    ) {
                        Row(
                            modifier = Modifier.padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Default.Call, contentDescription = null, tint = IVXGreen, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(10.dp))
                            Column {
                                Text("To: ${entry.to}", color = IVXOnSurface, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                Text("SID: ${entry.sid}", color = IVXGreen, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                            }
                        }
                    }
                }
            }
        }
    }
}
