"""AgentSquad: Parallel Domain-Specific Data Rescue Hive.

Contains specialized deterministic worker agents:
1. NetworkAgent: IP repairs, subnet heuristics, Tor exit node tagging
2. IdentityAgent: JSON session unpacking, timestamp normalization
3. ThreatAgent: Unstructured alert NLP/regex, MITRE mapping, severity scoring
4. ImputationAgent: Zero-drop contextual statistical imputation
5. Coordinator: Parallel orchestration, multi-worker reconciliation, and receipt stamping
"""

from .network_agent import NetworkAgent, NetworkAgentReport
from .identity_agent import IdentityAgent, IdentityAgentReport
from .threat_agent import ThreatAgent, ThreatAgentReport
from .imputation_agent import ImputationAgent, ImputationAgentReport
from .coordinator import AgentSquadCoordinator, AgentSquadResult
from .fuser import MultiTableFuser

__all__ = [
    "NetworkAgent",
    "NetworkAgentReport",
    "IdentityAgent",
    "IdentityAgentReport",
    "ThreatAgent",
    "ThreatAgentReport",
    "ImputationAgent",
    "ImputationAgentReport",
    "AgentSquadCoordinator",
    "AgentSquadResult",
    "MultiTableFuser",
]
