package com.ivxholdings.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ivxholdings.app.ui.theme.IVXBlue
import com.ivxholdings.app.ui.theme.IVXDark
import com.ivxholdings.app.ui.theme.IVXGold
import com.ivxholdings.app.ui.theme.IVXOnSurface
import com.ivxholdings.app.ui.theme.IVXOnSurfaceMuted
import com.ivxholdings.app.ui.theme.IVXRed
import com.ivxholdings.app.ui.theme.IVXSurfaceVariant
import com.ivxholdings.app.ui.viewmodel.AuthState
import com.ivxholdings.app.ui.viewmodel.AuthViewModel
import com.ivxholdings.app.util.AppConfig
import org.koin.androidx.compose.koinViewModel

@Composable
fun LoginScreen(
    onLoginSuccess: () -> Unit
) {
    val viewModel: AuthViewModel = koinViewModel()
    val state by viewModel.state.collectAsState()
    var isOwnerMode by remember { mutableStateOf(true) }
    var email by remember { mutableStateOf(AppConfig.OWNER_EMAIL) }
    var password by remember { mutableStateOf("") }
    var showDemo by remember { mutableStateOf(false) }

    LaunchedEffect(state) {
        when (state) {
            is AuthState.Authenticated -> onLoginSuccess()
            else -> {}
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(IVXDark)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .size(96.dp)
                .clip(CircleShape)
                .background(IVXGold),
            contentAlignment = Alignment.Center
        ) {
            Text(
                "IV",
                color = IVXDark,
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.displayMedium
            )
        }

        Spacer(modifier = Modifier.height(24.dp))
        Text(
            "IVX Holdings",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = IVXOnSurface
        )
        Text(
            "Unified Command Center",
            style = MaterialTheme.typography.titleMedium,
            color = IVXGold
        )

        Spacer(modifier = Modifier.height(32.dp))

        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center
                ) {
                    TextButton(onClick = { isOwnerMode = true }) {
                        Text(
                            "Owner",
                            color = if (isOwnerMode) IVXGold else IVXOnSurfaceMuted,
                            fontWeight = if (isOwnerMode) FontWeight.Bold else FontWeight.Normal
                        )
                    }
                    TextButton(onClick = { isOwnerMode = false }) {
                        Text(
                            "Member",
                            color = if (!isOwnerMode) IVXGold else IVXOnSurfaceMuted,
                            fontWeight = if (!isOwnerMode) FontWeight.Bold else FontWeight.Normal
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    if (isOwnerMode) "Passwordless Owner Login" else "Member Login",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(16.dp))
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = IVXDark,
                        unfocusedContainerColor = IVXDark,
                        focusedBorderColor = IVXGold,
                        unfocusedBorderColor = IVXOnSurfaceMuted
                    )
                )
                if (!isOwnerMode) {
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("Password") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedContainerColor = IVXDark,
                            unfocusedContainerColor = IVXDark,
                            focusedBorderColor = IVXGold,
                            unfocusedBorderColor = IVXOnSurfaceMuted
                        )
                    )
                }
                Spacer(modifier = Modifier.height(16.dp))
                Button(
                    onClick = {
                        if (isOwnerMode) {
                            viewModel.ownerLogin(email)
                        } else {
                            viewModel.memberLogin(email, password)
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = state !is AuthState.Loading,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = IVXGold,
                        contentColor = IVXDark,
                        disabledContainerColor = IVXGold.copy(alpha = 0.4f)
                    )
                ) {
                    if (state is AuthState.Loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            color = IVXDark,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Text(if (isOwnerMode) "Send Login Link" else "Sign In")
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
                Button(
                    onClick = { showDemo = true },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = IVXSurfaceVariant,
                        contentColor = IVXOnSurfaceMuted
                    )
                ) {
                    Text("Continue in Demo Mode")
                }
                if (state is AuthState.Error) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        (state as AuthState.Error).message,
                        color = IVXRed,
                        style = MaterialTheme.typography.bodySmall,
                        textAlign = TextAlign.Center
                    )
                }
                if (showDemo) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "Demo mode uses local data. Backend calls require authentication.",
                        color = IVXOnSurfaceMuted,
                        style = MaterialTheme.typography.bodySmall,
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(
                        onClick = onLoginSuccess,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = IVXBlue, contentColor = IVXOnSurface)
                    ) {
                        Text("Enter Demo Mode")
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))
        Text(
            "v${AppConfig.APP_VERSION} · Build ${AppConfig.VERSION_CODE} · ${AppConfig.GIT_SHA}",
            color = IVXOnSurfaceMuted,
            style = MaterialTheme.typography.bodySmall
        )
        Text(
            "com.ivxholdings.app",
            color = IVXOnSurfaceMuted,
            style = MaterialTheme.typography.bodySmall
        )
    }
}
