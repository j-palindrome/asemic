//! Transport clock: publishes `asemic/clock` (RealTime, express) at `ppq` ticks per beat.
//! Tempo lives in storage at `asemic/state/clock` as `{"bpm":..,"ppq":..}`.

use std::time::{Duration, Instant};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use zenoh::{
    Session,
    bytes::Encoding,
    qos::{CongestionControl, Priority},
};

use asemic_schema::keys;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Tempo {
    pub bpm: f64,
    pub ppq: u32,
    #[serde(default = "four")]
    pub beats_per_bar: u32,
}

fn four() -> u32 {
    4
}

impl Default for Tempo {
    fn default() -> Self {
        Self { bpm: 120.0, ppq: 24, beats_per_bar: 4 }
    }
}

impl Tempo {
    fn tick_period(&self) -> Duration {
        Duration::from_secs_f64(60.0 / self.bpm.clamp(1.0, 999.0) / self.ppq.max(1) as f64)
    }
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct Tick {
    pub tick: u64,
    pub beat: u64,
    pub bar: u64,
    pub phase: f64,
    pub bpm: f64,
    pub t: f64,
}

pub fn tick_at(n: u64, tempo: &Tempo, t: f64) -> Tick {
    let ppq = tempo.ppq.max(1) as u64;
    let beat = n / ppq;
    Tick {
        tick: n,
        beat,
        bar: beat / tempo.beats_per_bar.max(1) as u64,
        phase: (n % ppq) as f64 / ppq as f64,
        bpm: tempo.bpm,
        t,
    }
}

pub async fn run(session: Session) -> Result<()> {
    let tempo_sub = session.declare_subscriber(keys::CLOCK_STATE)
            .with(flume::unbounded()).await.map_err(anyhow::Error::msg)?;
    let mut tempo = restore_tempo(&session).await;
    let publisher = session
        .declare_publisher(keys::CLOCK)
        .encoding(Encoding::APPLICATION_JSON)
        .priority(Priority::RealTime)
        .congestion_control(CongestionControl::Drop)
        .express(true)
        .await
        .map_err(anyhow::Error::msg)?;

    let start = Instant::now();
    let mut next = Instant::now();
    let mut n: u64 = 0;
    loop {
        while let Ok(Some(s)) = tempo_sub.try_recv() {
            match serde_json::from_slice::<Tempo>(&s.payload().to_bytes()) {
                Ok(t) => tempo = t,
                Err(e) => tracing::warn!("bad tempo: {e}"),
            }
        }
        let tick = tick_at(n, &tempo, start.elapsed().as_secs_f64());
        publisher.put(serde_json::to_vec(&tick)?).await.map_err(anyhow::Error::msg)?;
        n += 1;
        next += tempo.tick_period();
        let now = Instant::now();
        if next < now {
            next = now; // overrun: skip ahead, !burst
        }
        tokio::time::sleep_until(next.into()).await;
    }
}

async fn restore_tempo(session: &Session) -> Tempo {
    if let Ok(replies) = session.get(keys::CLOCK_STATE).timeout(Duration::from_millis(500)).await {
        while let Ok(reply) = replies.recv_async().await {
            if let Ok(s) = reply.result() {
                if let Ok(t) = serde_json::from_slice(&s.payload().to_bytes()) {
                    return t;
                }
            }
        }
    }
    Tempo::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticks_roll_into_beats_and_bars() {
        let t = Tempo::default();
        let k = tick_at(24 * 4 * 2 + 24 + 12, &t, 0.0);
        assert_eq!((k.bar, k.beat), (2, 9));
        assert!((k.phase - 0.5).abs() < 1e-9);
    }

    #[test]
    fn period_matches_bpm() {
        let t = Tempo { bpm: 60.0, ppq: 4, beats_per_bar: 4 };
        assert!((t.tick_period().as_secs_f64() - 0.25).abs() < 1e-9);
    }
}
