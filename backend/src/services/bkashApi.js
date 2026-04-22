// ============================================================
// bKash Tokenized Checkout (sandbox / live)
// ------------------------------------------------------------
// Gated by system_settings feature.bkash_api + credentials.
// Docs: https://developer.bka.sh/docs
// ============================================================

import axios from 'axios';
import redis from '../utils/redisClient.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { getSetting } from './settings.js';

const TOKEN_KEY = 'bkash:id_token';
const TOKEN_TTL_SEC = 50 * 60;

function base() {
  return String(config.BKASH_BASE_URL || '').replace(/\/$/, '');
}

export function credentialsConfigured() {
  return !!(
    config.BKASH_APP_KEY &&
    config.BKASH_APP_SECRET &&
    config.BKASH_USERNAME &&
    config.BKASH_PASSWORD
  );
}

export async function isApiEnabled() {
  if (!credentialsConfigured()) return false;
  return !!(await getSetting('feature.bkash_api'));
}

/** True when tokenized checkout can run (credentials + flag + agreement ID). */
export async function isCheckoutReady() {
  if (!(await isApiEnabled())) return false;
  const fromDb = await getSetting('bkash.agreement_id');
  const envId = config.BKASH_AGREEMENT_ID;
  const id =
    (fromDb && String(fromDb).trim()) ||
    (envId && String(envId).trim()) ||
    '';
  return !!id;
}

async function agreementId() {
  const fromDb = await getSetting('bkash.agreement_id');
  if (fromDb && String(fromDb).trim()) return String(fromDb).trim();
  if (config.BKASH_AGREEMENT_ID) return String(config.BKASH_AGREEMENT_ID).trim();
  return '';
}

export async function getToken() {
  const cached = await redis.get(TOKEN_KEY);
  if (cached) return cached;

  const url = `${base()}/tokenized/checkout/token/grant`;
  const { data } = await axios.post(
    url,
    { app_key: config.BKASH_APP_KEY, app_secret: config.BKASH_APP_SECRET },
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        username: config.BKASH_USERNAME,
        password: config.BKASH_PASSWORD,
      },
      timeout: 30000,
      validateStatus: () => true,
    }
  );
  if (!data?.id_token) {
    logger.warn({ data }, 'bKash grant token failed');
    throw new Error(data?.statusMessage || data?.errorMessage || 'bKash token failed');
  }
  await redis.setex(TOKEN_KEY, TOKEN_TTL_SEC, data.id_token);
  return data.id_token;
}

/**
 * @returns {{ paymentID: string, bkashURL: string, raw: object }}
 */
export async function createPayment({
  amount,
  merchantInvoiceNumber,
  payerReference,
  callbackURL,
}) {
  const agr = await agreementId();
  if (!agr) {
    throw new Error('bKash agreement ID not configured (bkash.agreement_id or BKASH_AGREEMENT_ID)');
  }
  const token = await getToken();
  const url = `${base()}/tokenized/checkout/create`;
  const body = {
    mode: '0001',
    payerReference: String(payerReference || 'customer').replace(/[<>]/g, '').slice(0, 255),
    callbackURL: String(callbackURL).replace(/\/$/, ''),
    agreementID: agr,
    amount: String(amount),
    currency: 'BDT',
    intent: 'sale',
    merchantInvoiceNumber: String(merchantInvoiceNumber).replace(/[<>]/g, '').slice(0, 255),
  };
  const { data } = await axios.post(url, body, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: token,
      'X-App-Key': config.BKASH_APP_KEY,
    },
    timeout: 30000,
    validateStatus: () => true,
  });
  if (data?.statusCode !== '0000' || !data?.paymentID || !data?.bkashURL) {
    logger.warn({ data }, 'bKash create payment failed');
    throw new Error(data?.statusMessage || data?.errorMessage || 'bKash create failed');
  }
  return { paymentID: data.paymentID, bkashURL: data.bkashURL, raw: data };
}

export async function executePayment(paymentID) {
  const token = await getToken();
  const url = `${base()}/tokenized/checkout/execute`;
  const { data } = await axios.post(
    url,
    { paymentID },
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: token,
        'X-App-Key': config.BKASH_APP_KEY,
      },
      timeout: 30000,
      validateStatus: () => true,
    }
  );
  if (data?.transactionStatus !== 'Completed' && data?.statusCode !== '0000') {
    logger.warn({ data, paymentID }, 'bKash execute incomplete');
    throw new Error(data?.statusMessage || data?.errorMessage || 'bKash execute failed');
  }
  return data;
}

export async function queryPayment(paymentID) {
  const token = await getToken();
  const url = `${base()}/tokenized/checkout/payment/status/${encodeURIComponent(paymentID)}`;
  const { data } = await axios.get(url, {
    headers: {
      Accept: 'application/json',
      Authorization: token,
      'X-App-Key': config.BKASH_APP_KEY,
    },
    timeout: 30000,
    validateStatus: () => true,
  });
  return data;
}

export default {
  isApiEnabled,
  isCheckoutReady,
  credentialsConfigured,
  getToken,
  createPayment,
  executePayment,
  queryPayment,
};
