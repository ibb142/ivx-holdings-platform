package com.ivxholdings.app.ui.screens

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.ivxholdings.app.data.model.CertResultResponse
import com.ivxholdings.app.data.model.ExecutorStatusResponse
import com.ivxholdings.app.data.model.HealthCheckResponse
import com.ivxholdings.app.data.model.IAAgent
import com.ivxholdings.app.data.model.PipelineStatusResponse
import com.ivxholdings.app.ui.theme.IVXBlue
import com.ivxholdings.app.ui.theme.IVXDark
import com.ivxholdings.app.ui.theme.IVXGold
import com.ivxholdings.app.ui.theme.IVXGreen
import com.ivxholdings.app.ui.theme.IVXOnSurface
import com.ivxholdings.app.ui.theme.IVXOnSurfaceMuted
import com.ivxholdings.app.ui.theme.IVXRed
import com.ivxholdings.app.ui.theme.IVXSurface
import com.ivxholdings.app.ui.theme.IVXSurfaceVariant
import com.ivxholdings.app.ui.viewmodel.AutonomousDashboardViewModel
import org.koin.androidx.compose.koinViewModel

@Composable
fun AutonomousDashboardScreen(navController: NavController) {
    val viewModel: AutonomousDashboardViewModel = koinViewModel()
    val state by viewModel.state.collectAsState()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        Color(0xFF0A0A0F),
                        Color(0xFF0D0D14),
                        Color(0xFF0A0A0F)
                    )
                )
            )
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 24.dp)
        ) {
            item { DashboardHeader(state = state) }

            if (state.isLoading) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 80.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(color = IVXGold, strokeWidth = 3.dp, modifier = Modifier.size(48.dp))
                            Spacer(modifier = Modifier.height(16.dp))
                            Text("Connecting to 112 IA agents...", color = IVXOnSurfaceMuted, fontSize = 14.sp)
                        }
                    }
                }
            } else {
                state.error?.let { err ->
                    item { ErrorCard(message = err, onRetry = { viewModel.load() }) }
                }

                state.health?.let { item { HealthBanner(it) } }

                item { AgentsOverviewCard(agents = state.agents) }

                state.executorStatus?.let { item { ExecutorCapabilitiesCard(it) } }

                state.pipelineStatus?.let { item { PipelineCard(it) } }

                item { CertificationActionCard(state = state, onCertify = { viewModel.runCertification() }) }

                state.certResult?.let { item { CertResultCard(it) } }

                if (state.agents.isNotEmpty()) {
                    item {
                        Text(
                            "Live Agent Registry",
                            color = IVXGold,
                            fontWeight = FontWeight.Bold,
                            fontSize = 18.sp,
                            modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 8.dp)
                        )
                    }
                    items(state.agents.take(30)) { agent ->
                        AgentRow(agent)
                    }
                    if (state.agents.size > 30) {
                        item {
                            Text(
                                "+ ${state.agents.size - 30} more agents (Division B: IA-56 to IA-112)",
                                color = IVXOnSurfaceMuted,
                                fontSize = 13.sp,
                                modifier = Modifier.padding(16.dp)
                            )
                        }
                    }
                }
            }
        }
    }

    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.load() }
}

@Composable
private fun DashboardHeader(state: com.ivxholdings.app.ui.viewmodel.AutonomousDashboardState) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 20.dp, end = 20.dp, top = 48.dp, bottom = 16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(Brush.radialGradient(listOf(IVXGold, Color(0xFFB8860B)))),
                contentAlignment = Alignment.Center
            ) {
                Text("IV", color = IVXDark, fontWeight = FontWeight.Black, fontSize = 16.sp)
            }
            Spacer(modifier = Modifier.width(12.dp))
            Column {
                Text(
                    "IVX Autonomous Dashboard",
                    color = IVXOnSurface,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp
                )
                Text(
                    "112 IA Engineering Agents · Live",
                    color = IVXGold,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }
}

@Composable
private fun HealthBanner(health: HealthCheckResponse) {
    val isHealthy = health.status == "healthy" || health.status == "ok"
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isHealthy) IVXGreen.copy(alpha = 0.12f) else IVXRed.copy(alpha = 0.12f)
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Cloud,
                contentDescription = null,
                tint = if (isHealthy) IVXGreen else IVXRed,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                "Production: ${health.status}",
                color = if (isHealthy) IVXGreen else IVXRed,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp
            )
            Spacer(modifier = Modifier.weight(1f))
            Text(
                "SHA: ${health.commitShort.take(8)}",
                color = IVXOnSurfaceMuted,
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace
            )
        }
    }
}

@Composable
private fun AgentsOverviewCard(agents: List<IAAgent>) {
    val divisionA = agents.filter { it.division == "A" }
    val divisionB = agents.filter { it.division == "B" }
    val available = agents.count { it.available }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Devices, contentDescription = null, tint = IVXGold, modifier = Modifier.size(22.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text("Agent Fleet", color = IVXOnSurface, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            }
            Spacer(modifier = Modifier.height(16.dp))

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                StatBlock(value = agents.size.toString(), label = "Total Agents", color = IVXGold)
                StatBlock(value = available.toString(), label = "Available", color = IVXGreen)
                StatBlock(value = divisionA.size.toString(), label = "Division A", color = IVXBlue)
                StatBlock(value = divisionB.size.toString(), label = "Division B", color = Color(0xFF9C6ADE))
            }

            Spacer(modifier = Modifier.height(12.dp))

            val transition = rememberInfiniteTransition(label = "pulse")
            val pulseAlpha by transition.animateFloat(
                initialValue = 0.3f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(
                    animation = tween(1200, easing = LinearEasing),
                    repeatMode = RepeatMode.Reverse
                ),
                label = "pulseAlpha"
            )

            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(IVXGreen.copy(alpha = pulseAlpha))
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    "All agents connected via remote AI inference (openai/gpt-4o)",
                    color = IVXOnSurfaceMuted,
                    fontSize = 12.sp
                )
            }
        }
    }
}

@Composable
private fun StatBlock(value: String, label: String, color: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = color, fontWeight = FontWeight.Black, fontSize = 24.sp)
        Text(label, color = IVXOnSurfaceMuted, fontSize = 11.sp)
    }
}

@Composable
private fun ExecutorCapabilitiesCard(executor: ExecutorStatusResponse) {
    val caps = executor.capabilities
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Memory, contentDescription = null, tint = IVXBlue, modifier = Modifier.size(22.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text("Code Execution Layer", color = IVXOnSurface, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(executor.marker, color = IVXOnSurfaceMuted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)

            Spacer(modifier = Modifier.height(14.dp))

            CapabilityRow(icon = Icons.Default.Code, label = "File Writing", enabled = caps.fileWriting)
            CapabilityRow(icon = Icons.Default.Build, label = "Build Loop (max ${caps.maxBuildIterations} iterations)", enabled = caps.buildLoop)
            CapabilityRow(icon = Icons.Default.AutoAwesome, label = "AI Error Feedback", enabled = caps.aiErrorFeedback)
            CapabilityRow(icon = Icons.Default.CloudUpload, label = "Deploy to Production", enabled = caps.deployStep)

            Spacer(modifier = Modifier.height(12.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Speed, contentDescription = null, tint = IVXGold, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    "AI: ${executor.aiModel} · ${if (executor.aiConfigured) "Configured" else "Not configured"}",
                    color = IVXGold,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium
                )
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(executor.aiEndpoint, color = IVXOnSurfaceMuted, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
        }
    }
}

@Composable
private fun CapabilityRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, enabled: Boolean) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (enabled) IVXGreen else IVXRed,
            modifier = Modifier.size(18.dp)
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(label, color = IVXOnSurface, fontSize = 13.sp, modifier = Modifier.weight(1f))
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(6.dp))
                .background(if (enabled) IVXGreen.copy(alpha = 0.2f) else IVXRed.copy(alpha = 0.2f))
                .padding(horizontal = 8.dp, vertical = 2.dp)
        ) {
            Text(
                if (enabled) "ONLINE" else "OFFLINE",
                color = if (enabled) IVXGreen else IVXRed,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

@Composable
private fun PipelineCard(pipeline: PipelineStatusResponse) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Terminal, contentDescription = null, tint = Color(0xFF9C6ADE), modifier = Modifier.size(22.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text("30-Agent App Creation Pipeline", color = IVXOnSurface, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text("Agent Range: ${pipeline.agentRange}", color = IVXOnSurfaceMuted, fontSize = 12.sp)
            Spacer(modifier = Modifier.height(4.dp))
            Text("Total Agents: ${pipeline.totalAgents}", color = IVXGold, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            Spacer(modifier = Modifier.height(4.dp))
            Text("Model: ${pipeline.model}", color = IVXOnSurfaceMuted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
            Spacer(modifier = Modifier.height(4.dp))
            Text("GitHub SHA: ${pipeline.githubSha.take(12)}", color = IVXOnSurfaceMuted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
        }
    }
}

@Composable
private fun CertificationActionCard(
    state: com.ivxholdings.app.ui.viewmodel.AutonomousDashboardState,
    onCertify: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Verified, contentDescription = null, tint = IVXGold, modifier = Modifier.size(22.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text("Live Certification", color = IVXOnSurface, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                "Trigger a live AI agent to generate code, write it to disk, run a build loop, and certify the code execution layer end-to-end.",
                color = IVXOnSurfaceMuted,
                fontSize = 13.sp
            )
            Spacer(modifier = Modifier.height(16.dp))

            Button(
                onClick = onCertify,
                enabled = !state.isCertifying,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = IVXGold,
                    contentColor = IVXDark
                )
            ) {
                if (state.isCertifying) {
                    CircularProgressIndicator(
                        color = IVXDark,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Certifying...", fontWeight = FontWeight.Bold)
                } else {
                    Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(20.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Run 112-Agent Cert", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun CertResultCard(cert: CertResultResponse) {
    val successColor = if (cert.certified) IVXGreen else IVXRed
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = successColor.copy(alpha = 0.08f)
        )
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (cert.certified) Icons.Default.CheckCircle else Icons.Default.Schedule,
                    contentDescription = null,
                    tint = successColor,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(modifier = Modifier.width(10.dp))
                Column {
                    Text(
                        if (cert.certified) "CERTIFIED" else "FAILED",
                        color = successColor,
                        fontWeight = FontWeight.Black,
                        fontSize = 18.sp
                    )
                    Text(cert.certId, color = IVXOnSurfaceMuted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                StatBlock(value = cert.llmCallCount.toString(), label = "LLM Calls", color = IVXGold)
                StatBlock(value = "${cert.totalDurationMs / 1000}s", label = "Duration", color = IVXBlue)
                StatBlock(value = cert.aiModel.take(12), label = "AI Model", color = Color(0xFF9C6ADE))
            }

            Spacer(modifier = Modifier.height(12.dp))

            InfoRow(label = "AI Source", value = cert.aiSource)
            InfoRow(label = "Proof Hash", value = cert.proofHash)
            InfoRow(label = "Marker", value = cert.marker)

            Spacer(modifier = Modifier.height(8.dp))
            Text(
                cert.summary,
                color = IVXOnSurfaceMuted,
                fontSize = 12.sp
            )
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, color = IVXOnSurfaceMuted, fontSize = 12.sp)
        Text(value, color = IVXOnSurface, fontSize = 12.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun AgentRow(agent: IAAgent) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 3.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(IVXSurface.copy(alpha = 0.5f))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(
                    if (agent.division == "A") IVXBlue.copy(alpha = 0.2f) else Color(0xFF9C6ADE).copy(alpha = 0.2f)
                ),
            contentAlignment = Alignment.Center
        ) {
            Text(
                "${agent.agentNumber}",
                color = if (agent.division == "A") IVXBlue else Color(0xFF9C6ADE),
                fontWeight = FontWeight.Bold,
                fontSize = 13.sp
            )
        }
        Spacer(modifier = Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                agent.name,
                color = IVXOnSurface,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp
            )
            Text(
                agent.role,
                color = IVXOnSurfaceMuted,
                fontSize = 11.sp
            )
        }
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(if (agent.available) IVXGreen else IVXRed)
        )
    }
}

@Composable
private fun ErrorCard(message: String, onRetry: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = IVXRed.copy(alpha = 0.1f))
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(message, color = IVXRed, fontSize = 14.sp)
            Spacer(modifier = Modifier.height(12.dp))
            Button(onClick = onRetry, colors = ButtonDefaults.buttonColors(containerColor = IVXGold, contentColor = IVXDark)) {
                Text("Retry")
            }
        }
    }
}
