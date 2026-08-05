#!/usr/bin/env node

/**
 * IVX Holdings — Full AWS Setup: Route53 + ACM + CloudFormation
 * Run: node deploy/scripts/aws-full-setup.mjs
 */

import { Route53Client, CreateHostedZoneCommand, ListHostedZonesByNameCommand, ChangeResourceRecordSetsCommand, GetHostedZoneCommand } from "@aws-sdk/client-route-53";
import { ACMClient, RequestCertificateCommand, DescribeCertificateCommand, ListCertificatesCommand } from "@aws-sdk/client-acm";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { ECRClient, DescribeRepositoriesCommand } from "@aws-sdk/client-ecr";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const REGION        = process.env.AWS_REGION || "us-east-1";
const APP_NAME      = "ivx-holdings";
const DOMAIN        = "ivxholding.com";
const API_DOMAIN    = "api.ivxholding.com";
const APP_DOMAIN    = "app.ivxholding.com";
const WWW_DOMAIN    = "www.ivxholding.com";
const STACK_NAME    = `${APP_NAME}-stack`;
const API_TARGET_DNS = readOptionalDnsEnv("API_TARGET_DNS") || readOptionalDnsEnv("API_ELB_DNS");
const APP_TARGET_DNS = readOptionalDnsEnv("APP_TARGET_DNS");
const WWW_TARGET_DNS = readOptionalDnsEnv("WWW_TARGET_DNS");
const API_TARGET_HOSTED_ZONE_ID = (process.env.API_TARGET_HOSTED_ZONE_ID || "").trim();
const APP_TARGET_HOSTED_ZONE_ID = (process.env.APP_TARGET_HOSTED_ZONE_ID || "").trim();
const WWW_TARGET_HOSTED_ZONE_ID = (process.env.WWW_TARGET_HOSTED_ZONE_ID || "").trim();

const creds = {
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  region: REGION,
};

const route53  = new Route53Client({ ...creds, region: "us-east-1" });
const acm      = new ACMClient({ ...creds, region: "us-east-1" }); // ACM must be us-east-1 for ALB
const cf       = new CloudFormationClient(creds);
const ecr      = new ECRClient(creds);

const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const BLUE   = "\x1b[34m";
const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";

const log  = (msg) => console.log(`${BLUE}[INFO]${RESET} ${msg}`);
const ok   = (msg) => console.log(`${GREEN}[OK]${RESET} ${msg}`);
const warn = (msg) => console.log(`${YELLOW}[WARN]${RESET} ${msg}`);
const err  = (msg) => console.log(`${RED}[ERROR]${RESET} ${msg}`);
const step = (msg) => console.log(`\n${BOLD}${BLUE}━━━ ${msg} ━━━${RESET}`);

// ─── HELPERS ─────────────────────────────────────────────────────────────────
async function getAccountId() {
  const sts = new STSClient(creds);
  const r = await sts.send(new GetCallerIdentityCommand({}));
  return r.Account;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function readOptionalDnsEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").replace(/\.$/, "");
}

function normalizeDnsValue(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").replace(/\.$/, "");
}

function normalizeHostedZoneId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function ensureAliasDnsName(value) {
  const normalized = normalizeDnsValue(value);
  if (normalized.includes("elb.amazonaws.com") && !normalized.startsWith("dualstack.")) {
    return `dualstack.${normalized}`;
  }
  return normalized;
}

function getDnsTargets(albTarget) {
  const normalizedAlbDns = normalizeDnsValue(albTarget?.dnsName);
  const normalizedAlbHostedZoneId = normalizeHostedZoneId(albTarget?.hostedZoneId);

  return {
    api: {
      dnsName: API_TARGET_DNS || normalizedAlbDns,
      hostedZoneId: normalizeHostedZoneId(API_TARGET_HOSTED_ZONE_ID) || normalizedAlbHostedZoneId,
    },
    app: {
      dnsName: APP_TARGET_DNS || normalizedAlbDns,
      hostedZoneId: normalizeHostedZoneId(APP_TARGET_HOSTED_ZONE_ID) || normalizedAlbHostedZoneId,
    },
    www: {
      dnsName: WWW_TARGET_DNS || normalizedAlbDns,
      hostedZoneId: normalizeHostedZoneId(WWW_TARGET_HOSTED_ZONE_ID) || normalizedAlbHostedZoneId,
    },
    defaultAlbDns: normalizedAlbDns,
    defaultAlbHostedZoneId: normalizedAlbHostedZoneId,
  };
}

// ─── STEP 1: CHECK AWS CREDENTIALS ───────────────────────────────────────────
async function checkCredentials() {
  step("Step 1: Verifying AWS Credentials");
  try {
    const accountId = await getAccountId();
    ok(`Authenticated — Account: ${accountId} | Region: ${REGION}`);
    return accountId;
  } catch (e) {
    err(`AWS credentials invalid: ${e.message}`);
    process.exit(1);
  }
}

// ─── STEP 2: ROUTE53 HOSTED ZONE ─────────────────────────────────────────────
async function setupHostedZone() {
  step("Step 2: Route53 Hosted Zone for ivxholding.com");

  const listResp = await route53.send(new ListHostedZonesByNameCommand({ DNSName: DOMAIN }));
  const existing = listResp.HostedZones?.find(z => z.Name === `${DOMAIN}.`);

  if (existing) {
    const zoneId = existing.Id.replace("/hostedzone/", "");
    ok(`Hosted zone already exists: ${zoneId}`);
    return zoneId;
  }

  log(`Creating hosted zone for ${DOMAIN}...`);
  const resp = await route53.send(new CreateHostedZoneCommand({
    Name: DOMAIN,
    CallerReference: `ivx-holdings-${Date.now()}`,
    HostedZoneConfig: {
      Comment: "IVX Holdings - Created by setup script",
      PrivateZone: false,
    },
  }));

  const zoneId = resp.HostedZone.Id.replace("/hostedzone/", "");
  ok(`Created hosted zone: ${zoneId}`);

  console.log(`\n${BOLD}${YELLOW}⚠️  IMPORTANT — Name Servers for ${DOMAIN}:${RESET}`);
  console.log(`${YELLOW}Point your domain registrar to these NS records:${RESET}`);
  resp.DelegationSet.NameServers.forEach(ns => console.log(`  ${GREEN}→ ${ns}${RESET}`));
  console.log(`\n${YELLOW}If you already have a hosted zone, update your registrar NS records.${RESET}\n`);

  return zoneId;
}

async function getHostedZoneNameServers(zoneId) {
  const resp = await route53.send(new GetHostedZoneCommand({ Id: zoneId }));
  return resp.DelegationSet?.NameServers || [];
}

// ─── STEP 3: ACM CERTIFICATE ─────────────────────────────────────────────────
async function setupCertificate(zoneId) {
  step("Step 3: ACM SSL/TLS Certificate");

  const listResp = await acm.send(new ListCertificatesCommand({ CertificateStatuses: ["ISSUED", "PENDING_VALIDATION"] }));
  const existing = listResp.CertificateSummaryList?.find(c =>
    c.DomainName === DOMAIN || c.DomainName === `*.${DOMAIN}`
  );

  if (existing) {
    const desc = await acm.send(new DescribeCertificateCommand({ CertificateArn: existing.CertificateArn }));
    const status = desc.Certificate.Status;
    if (status === "ISSUED") {
      ok(`Certificate already ISSUED: ${existing.CertificateArn}`);
      return existing.CertificateArn;
    }
    if (status === "PENDING_VALIDATION") {
      warn(`Certificate is PENDING_VALIDATION: ${existing.CertificateArn}`);
      warn("Auto-creating DNS validation records...");
      await createCertValidationRecords(zoneId, desc.Certificate);
      return existing.CertificateArn;
    }
  }

  log(`Requesting ACM certificate for *.${DOMAIN} and ${DOMAIN}...`);
  const resp = await acm.send(new RequestCertificateCommand({
    DomainName: `*.${DOMAIN}`,
    SubjectAlternativeNames: [DOMAIN, `*.${DOMAIN}`],
    ValidationMethod: "DNS",
    Tags: [{ Key: "Project", Value: "IVX-Holdings" }],
  }));

  const certArn = resp.CertificateArn;
  ok(`Certificate requested: ${certArn}`);

  log("Waiting for validation DNS records to be available (15s)...");
  await sleep(15000);

  const desc = await acm.send(new DescribeCertificateCommand({ CertificateArn: certArn }));
  await createCertValidationRecords(zoneId, desc.Certificate);

  return certArn;
}

async function createCertValidationRecords(zoneId, cert) {
  const records = [];
  for (const opt of cert.DomainValidationOptions || []) {
    if (opt.ResourceRecord && !records.find(r => r.Name === opt.ResourceRecord.Name)) {
      records.push(opt.ResourceRecord);
    }
  }

  if (records.length === 0) {
    warn("No DNS validation records available yet — check ACM console in a few minutes.");
    return;
  }

  const changes = records.map(r => ({
    Action: "UPSERT",
    ResourceRecordSet: {
      Name: r.Name,
      Type: r.Type,
      TTL: 300,
      ResourceRecords: [{ Value: r.Value }],
    },
  }));

  await route53.send(new ChangeResourceRecordSetsCommand({
    HostedZoneId: zoneId,
    ChangeBatch: { Changes: changes, Comment: "ACM DNS validation" },
  }));

  ok(`Created ${records.length} ACM validation DNS record(s) in Route53`);
  warn("Certificate validation takes 5–30 minutes. Continue setup; it validates in background.");
}

// ─── STEP 4: GET ALB DNS ──────────────────────────────────────────────────────
async function getALBDns() {
  step("Step 4: Checking ALB / CloudFormation Stack");

  if (API_TARGET_DNS) {
    ok(`API target override supplied: ${API_TARGET_DNS}`);
  }

  try {
    const resp = await cf.send(new DescribeStacksCommand({ StackName: STACK_NAME }));
    const stack = resp.Stacks?.[0];

    if (!stack) {
      warn(`CloudFormation stack '${STACK_NAME}' not found.`);
      warn("You need to deploy the stack first — see deploy/scripts/setup-aws.sh");
      return null;
    }

    const status = stack.StackStatus;
    const albOutput = stack.Outputs?.find((o) => o.OutputKey === "ALBDNS");
    const albHostedZoneIdOutput = stack.Outputs?.find((o) => o.OutputKey === "ALBCanonicalHostedZoneID");

    if (albOutput?.OutputValue) {
      const dnsName = normalizeDnsValue(albOutput.OutputValue);
      const hostedZoneId = normalizeHostedZoneId(albHostedZoneIdOutput?.OutputValue);
      ok(`Stack status: ${status}`);
      ok(`ALB DNS: ${dnsName}`);
      if (hostedZoneId) {
        ok(`ALB canonical hosted zone ID: ${hostedZoneId}`);
      }
      return {
        dnsName,
        hostedZoneId: hostedZoneId || null,
      };
    }

    warn(`Stack exists (status: ${status}) but no ALB DNS output yet.`);
    return null;
  } catch (e) {
    if (e.message?.includes("does not exist")) {
      warn(`Stack '${STACK_NAME}' does not exist yet.`);
      return null;
    }
    throw e;
  }
}

// ─── STEP 5: DNS RECORDS ──────────────────────────────────────────────────────
async function setupDNSRecords(zoneId, albTarget) {
  step("Step 5: DNS Records for ivxholding.com");

  const targets = getDnsTargets(albTarget);
  const records = [
    { name: `${API_DOMAIN}.`, target: targets.api },
    { name: `${APP_DOMAIN}.`, target: targets.app },
    { name: `${WWW_DOMAIN}.`, target: targets.www },
  ].filter((record) => Boolean(record.target.dnsName));

  if (records.length === 0) {
    warn("Skipping DNS records — no ELB DNS or explicit upstream override is available.");
    warn("Set API_TARGET_DNS, APP_TARGET_DNS, or WWW_TARGET_DNS and rerun this script.");
    return [];
  }

  if (targets.api.dnsName && targets.api.dnsName !== targets.defaultAlbDns) {
    ok(`Using explicit API DNS target override: ${targets.api.dnsName}`);
  }

  if (!targets.app.dnsName) {
    warn(`Skipping ${APP_DOMAIN} — no stack ALB or APP_TARGET_DNS override was found.`);
  }

  if (!targets.www.dnsName) {
    warn(`Skipping ${WWW_DOMAIN} — no stack ALB or WWW_TARGET_DNS override was found.`);
  }

  const recordSummaries = records.map((record) => {
    const normalizedTarget = normalizeDnsValue(record.target.dnsName);
    const hostedZoneId = normalizeHostedZoneId(record.target.hostedZoneId);
    const useAlias = Boolean(hostedZoneId) && normalizedTarget.includes("elb.amazonaws.com");

    if (useAlias) {
      return {
        name: record.name,
        type: "A",
        alias: true,
        value: ensureAliasDnsName(normalizedTarget),
        hostedZoneId,
      };
    }

    return {
      name: record.name,
      type: "CNAME",
      alias: false,
      value: normalizedTarget,
      ttl: 300,
      hostedZoneId: null,
    };
  });

  const changes = recordSummaries.map((record) => {
    if (record.alias) {
      return {
        Action: "UPSERT",
        ResourceRecordSet: {
          Name: record.name,
          Type: record.type,
          AliasTarget: {
            DNSName: record.value,
            HostedZoneId: record.hostedZoneId,
            EvaluateTargetHealth: false,
          },
        },
      };
    }

    return {
      Action: "UPSERT",
      ResourceRecordSet: {
        Name: record.name,
        Type: record.type,
        TTL: record.ttl,
        ResourceRecords: [{ Value: record.value }],
      },
    };
  });

  await route53.send(new ChangeResourceRecordSetsCommand({
    HostedZoneId: zoneId,
    ChangeBatch: {
      Changes: changes,
      Comment: "IVX Holdings DNS records — Route53 alias/CNAME mapping",
    },
  }));

  ok(`Upserted ${recordSummaries.length} DNS record(s):`);
  recordSummaries.forEach((record) => {
    if (record.alias) {
      ok(`  ${record.name} → A (Alias) ${record.value} [${record.hostedZoneId}]`);
    } else {
      ok(`  ${record.name} → ${record.type} ${record.value}`);
    }
  });
  return recordSummaries;
}

// ─── STEP 6: CHECK ECR ────────────────────────────────────────────────────────
async function checkECR(accountId) {
  step("Step 6: ECR Repository");
  try {
    const resp = await ecr.send(new DescribeRepositoriesCommand({ repositoryNames: [`${APP_NAME}-api`] }));
    const repo = resp.repositories?.[0];
    ok(`ECR repo exists: ${repo.repositoryUri}`);
    return repo.repositoryUri;
  } catch (e) {
    if (e.name === "RepositoryNotFoundException") {
      warn(`ECR repo '${APP_NAME}-api' not found. It will be created by CloudFormation.`);
      return `${accountId}.dkr.ecr.${REGION}.amazonaws.com/${APP_NAME}-api`;
    }
    throw e;
  }
}

// ─── STEP 7: PRINT SUMMARY ────────────────────────────────────────────────────
function printSummary(data) {
  console.log(`\n${BOLD}${"━".repeat(60)}${RESET}`);
  console.log(`${BOLD}  IVX Holdings — AWS Setup Summary${RESET}`);
  console.log(`${"━".repeat(60)}`);
  console.log(`\n  ${GREEN}Domain:${RESET}          ${DOMAIN}`);
  console.log(`  ${GREEN}Hosted Zone:${RESET}     ${data.zoneId}`);
  console.log(`  ${GREEN}Certificate:${RESET}     ${data.certArn}`);
  console.log(`  ${GREEN}ALB DNS:${RESET}         ${data.albTarget?.dnsName || "Not deployed yet"}`);
  if (data.albTarget?.hostedZoneId) {
    console.log(`  ${GREEN}ALB Zone:${RESET}        ${data.albTarget.hostedZoneId}`);
  }
  console.log(`  ${GREEN}ECR Repo:${RESET}        ${data.ecrUri}`);
  console.log(`  ${GREEN}Region:${RESET}          ${REGION}`);
  if (Array.isArray(data.dnsRecords) && data.dnsRecords.length > 0) {
    console.log(`  ${GREEN}DNS Records:${RESET}`);
    data.dnsRecords.forEach((record) => {
      if (record.alias) {
        console.log(`                         ${record.name} → A (Alias) ${record.value} [${record.hostedZoneId}]`);
      } else {
        console.log(`                         ${record.name} → ${record.type} ${record.value}`);
      }
    });
  }

  if (data.nameServers?.length) {
    console.log(`\n${BOLD}${YELLOW}  ⚠️  Set these NS records at your domain registrar (e.g. GoDaddy, Namecheap):${RESET}`);
    data.nameServers.forEach(ns => console.log(`     ${GREEN}NS → ${ns}${RESET}`));
  }

  console.log(`\n${BOLD}  NEXT STEPS:${RESET}`);

  if (!data.albTarget?.dnsName && (!Array.isArray(data.dnsRecords) || data.dnsRecords.length === 0)) {
    console.log(`  ${YELLOW}1. Deploy CloudFormation stack:${RESET}`);
    console.log(`     CERTIFICATE_ARN="${data.certArn}" ./deploy/scripts/setup-aws.sh`);
  } else if (!data.albTarget?.dnsName) {
    console.log(`  ${GREEN}1. DNS updated using explicit upstream override(s) ✓${RESET}`);
  } else {
    console.log(`  ${GREEN}1. Stack deployed ✓${RESET}`);
  }

  console.log(`  ${YELLOW}2. Wait for certificate validation (5–30 min)${RESET}`);
  console.log(`  ${YELLOW}3. Test: curl https://${API_DOMAIN}/health${RESET}`);
  console.log(`  ${YELLOW}4. If domain not resolving yet, update registrar NS records above${RESET}`);
  console.log(`\n${BOLD}  DNS Check Commands:${RESET}`);
  console.log(`     nslookup ${API_DOMAIN}`);
  console.log(`     nslookup ${DOMAIN}`);
  console.log(`     curl -I https://${API_DOMAIN}/health`);
  console.log(`\n${"━".repeat(60)}\n`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}${BLUE}${"━".repeat(60)}${RESET}`);
  console.log(`${BOLD}${BLUE}  IVX Holdings — Full AWS DNS + Domain Setup${RESET}`);
  console.log(`${BOLD}${BLUE}${"━".repeat(60)}${RESET}\n`);

  try {
    const accountId = await checkCredentials();
    const zoneId    = await setupHostedZone();
    const nameServers = await getHostedZoneNameServers(zoneId);
    const certArn   = await setupCertificate(zoneId);
    const albTarget = await getALBDns();
    const dnsRecords = await setupDNSRecords(zoneId, albTarget);
    const ecrUri    = await checkECR(accountId);

    printSummary({ zoneId, certArn, albTarget, ecrUri, nameServers, dnsRecords });

  } catch (e) {
    err(`Fatal error: ${e.message}`);
    console.error(e);
    process.exit(1);
  }
}

void main();
