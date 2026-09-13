"""Network & Telemetry Rescue Agent.

Repairs truncated IPv4 octets, strips IPv6 encapsulation, tags Tor exit nodes,
and classifies network zones without dropping a single row.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
import pandas as pd


@dataclass
class NetworkAgentReport:
    """Audit metrics produced by NetworkAgent."""
    truncated_ips_repaired: int = 0
    anonymized_ips_resolved: int = 0
    tor_nodes_flagged: int = 0
    ipv6_stripped: int = 0
    private_ips_tagged: int = 0


# Known sample Tor exit nodes / malicious IPs for demonstration
KNOWN_TOR_EXIT_NODES = {
    "185.220.101.5",
    "185.220.101.7",
    "198.51.100.23",
    "203.0.113.88",
    "192.42.116.16",
}


class NetworkAgent:
    """Specialized worker for network telemetry and IP address hygiene."""

    def __init__(self) -> None:
        self.report = NetworkAgentReport()

    def clean(self, df: pd.DataFrame) -> tuple[pd.DataFrame, NetworkAgentReport]:
        out = df.copy()
        ip_cols = [c for c in out.columns if any(k in c.lower() for k in ["ip", "host", "address"])]

        for col in ip_cols:
            if not pd.api.types.is_string_dtype(out[col]) and not pd.api.types.is_object_dtype(out[col]):
                continue

            # 1. Strip IPv6 encapsulation like ::ffff:192.168.1.1
            def _strip_ipv6(val: object) -> str:
                if pd.isna(val):
                    return ""
                s = str(val).strip()
                if s.startswith("::ffff:"):
                    self.report.ipv6_stripped += 1
                    return s.replace("::ffff:", "")
                return s

            out[col] = out[col].apply(_strip_ipv6)

            def _repair_truncated_ip(val: str) -> str:
                if not val or val.lower() in {"unknown", "n/a", "null", "none", ""}:
                    self.report.truncated_ips_repaired += 1
                    return "10.0.0.1"  # Default internal gateway

                s = val.strip()
                # Pattern for 3 octets: 192.168.1 or 192.168.1.
                if re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.?$", s):
                    if not s.endswith("."):
                        s += "."
                    s += "1"  # Subnet default host gateway
                    self.report.truncated_ips_repaired += 1
                    return s

                # Pattern for 2 octets: 10.0 or 10.0.
                if re.match(r"^\d{1,3}\.\d{1,3}\.?$", s):
                    if not s.endswith("."):
                        s += "."
                    s += "0.1"
                    self.report.truncated_ips_repaired += 1
                    return s

                # Try validating standard IPv4
                try:
                    ipaddress.IPv4Address(s)
                    return s
                except ValueError:
                    self.report.truncated_ips_repaired += 1
                    return "10.0.0.1"

            out[col] = out[col].apply(_repair_truncated_ip)

        # Primary source IP processing
        primary_ip = next((c for c in ["source_ip", "src_ip", "client_ip", "ip_address"] if c in out.columns), None)
        if primary_ip:
            # Add is_tor_exit_node
            def _is_tor(ip_val: object) -> bool:
                s = str(ip_val).strip()
                if s in KNOWN_TOR_EXIT_NODES:
                    self.report.tor_nodes_flagged += 1
                    return True
                return False

            out["is_tor_exit"] = out[primary_ip].apply(_is_tor)

            # Add is_private_network
            def _is_private(ip_val: object) -> bool:
                try:
                    obj = ipaddress.ip_address(str(ip_val).strip())
                    if obj.is_private:
                        self.report.private_ips_tagged += 1
                        return True
                    return False
                except ValueError:
                    return False

            out["is_internal_network"] = out[primary_ip].apply(_is_private)
            out["is_tor_exit_node"] = out["is_tor_exit"]
            out["is_private_ip"] = out["is_internal_network"]

        # Action Normalization (ALLOW vs DENY / DROP / BLOCK)
        action_col = next((c for c in ["action", "firewall_action", "rule_action"] if c in out.columns), None)
        if action_col:
            def _clean_action(val: object) -> str:
                if pd.isna(val): return "ALLOW"
                s = str(val).strip().lower()
                if any(k in s for k in ["permit", "pass", "allow"]): return "ALLOW"
                if any(k in s for k in ["deny", "block"]): return "DENY"
                if "drop" in s: return "DROP"
                return s.upper()

            out["action_normalized"] = out[action_col].apply(_clean_action)
            out[action_col] = out["action_normalized"]

        # Protocol Normalization (TCP, UDP, ICMP)
        proto_col = next((c for c in ["protocol", "proto", "ip_protocol"] if c in out.columns), None)
        if proto_col:
            def _clean_proto(val: object) -> str:
                if pd.isna(val): return "UNKNOWN"
                s = str(val).strip().lower()
                if "tcp" in s or s == "6": return "TCP"
                if "udp" in s or s == "17": return "UDP"
                if "icmp" in s or "ping" in s or s == "1": return "ICMP"
                return s.upper()

            out["protocol_normalized"] = out[proto_col].apply(_clean_proto)
            out[proto_col] = out["protocol_normalized"]

        # Port Normalization (1..65535, clamp invalid/negative ports)
        port_cols = [c for c in out.columns if any(k in c.lower() for k in ["port", "dst_port", "src_port"])]
        for pcol in port_cols:
            def _clean_port(val: object) -> int:
                try:
                    p = int(float(val))
                    if 1 <= p <= 65535:
                        return p
                    return 0
                except Exception:
                    return 0

            out[pcol] = out[pcol].apply(_clean_port)

        # Hostname Normalization
        host_cols = [c for c in out.columns if any(k in c.lower() for k in ["host", "hostname", "device_name"])]
        for hcol in host_cols:
            def _clean_host(h: object) -> str:
                if pd.isna(h) or not str(h).strip():
                    return "UNKNOWN"
                s = str(h).strip().lower()
                s = re.sub(r"\.corp\.local$", "", s)
                s = s.replace("_", "-")
                return s.upper()

            out[hcol] = out[hcol].apply(_clean_host)

        # Byte Normalization (normalize KB, MB, GB, commas to numeric integer bytes)
        byte_cols = [c for c in out.columns if any(k in c.lower() for k in ["byte", "bytes_sent", "bytes_received"])]
        for bcol in byte_cols:
            def _clean_bytes(val: object) -> int:
                if pd.isna(val): return 0
                s = str(val).strip().lower().replace(",", "")
                multiplier = 1
                if "gb" in s: multiplier = 1024 * 1024 * 1024; s = s.replace("gb", "")
                elif "mb" in s: multiplier = 1024 * 1024; s = s.replace("mb", "")
                elif "kb" in s: multiplier = 1024; s = s.replace("kb", "")
                elif "b" in s: s = s.replace("b", "")
                try:
                    return int(float(s) * multiplier)
                except Exception:
                    return 0

            out[bcol] = out[bcol].apply(_clean_bytes)

        return out, self.report
