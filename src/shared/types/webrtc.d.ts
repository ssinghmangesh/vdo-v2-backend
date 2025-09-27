// WebRTC Type Declarations for Node.js Environment

declare global {
  interface RTCSessionDescriptionInit {
    type?: "offer" | "pranswer" | "answer" | "rollback";
    sdp?: string;
  }

  interface RTCIceCandidateInit {
    candidate?: string;
    sdpMLineIndex?: number | null;
    sdpMid?: string | null;
    usernameFragment?: string | null;
  }

  interface RTCIceServer {
    urls: string | string[];
    username?: string;
    credential?: string;
  }

  type RTCPeerConnectionState = 
    | "closed"
    | "connected" 
    | "connecting"
    | "disconnected"
    | "failed"
    | "new";
}

export {};
