#!/bin/bash

# Pastikan OCI CLI dikenali (karena berjalan via PM2)
export PATH=/home/myubuntu/bin:$PATH

PAYLOAD_FILE="/home/myubuntu/oci-claimer/oci_payload.json"

echo "=============================================="
echo "   Memulai Pengeklaim Kapasitas OCI Ampere    "
echo "=============================================="

while true; do
  echo "=> [$(date)] Mengirim request pembuatan VM OCI Ampere..."
  
  # Run the OCI command gracefully
  OUTPUT=$(oci compute instance launch --from-json "file://$PAYLOAD_FILE" 2>&1)
  
  if echo "$OUTPUT" | grep -q 'Out of host capacity'; then
    echo "=> Gagal: Out of host capacity. (Wajar, server penuh). Menunggu 5 menit..."
    sleep 300
  elif echo "$OUTPUT" | grep -q 'TooManyRequests'; then
    echo "=> Gagal: API Limit Terkena (Too Many Requests). Menunggu 15 menit agar aman..."
    sleep 900
  elif echo "$OUTPUT" | grep -q 'LimitExceeded'; then
    echo "=> Gagal: Kuota Limit Akun telah tercapai."
    sleep 3600
  elif echo "$OUTPUT" | grep -i -q 'NotAuthorizedOrNotFound'; then
    echo "=> ERROR: API OCI gagal verifikasi kredensial (.pem salah / Config salah)."
    sleep 3600
  else
    echo "=> !!! PESAN TIDAK DIKENAL ATAU BERHASIL !!!"
    echo "$OUTPUT"
    # Menghubungi Bot WA lokal via Express route
    curl -s http://127.0.0.1:3000/oci-success
    echo "=> Menghentikan daemon. (Cek dasbor OCI Anda!)"
    exit 0
  fi
done
