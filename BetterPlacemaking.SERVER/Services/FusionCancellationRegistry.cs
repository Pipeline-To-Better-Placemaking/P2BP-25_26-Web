using System.Collections.Concurrent;

namespace BetterPlacemaking.Services
{
    /// <summary>
    /// Process-wide registry of in-flight fusion runs. Lets an HTTP endpoint
    /// cancel a run whose CancellationTokenSource is otherwise trapped inside
    /// a Task.Run closure in FusionService.TriggerFusion.
    /// </summary>
    public class FusionCancellationRegistry
    {
        private readonly ConcurrentDictionary<string, CancellationTokenSource> _active = new();

        public void Register(string runId, CancellationTokenSource cts)
            => _active[runId] = cts;

        public void Unregister(string runId)
            => _active.TryRemove(runId, out _);

        /// <summary>
        /// Returns true if a live run with this id was found and signalled.
        /// Returns false if the run isn't active in this process (finished,
        /// never existed, or lives in a previous process after a restart).
        /// </summary>
        public bool TryCancel(string runId)
        {
            if (!_active.TryRemove(runId, out var cts)) return false;
            try { cts.Cancel(); } catch (ObjectDisposedException) { }
            return true;
        }

        public bool IsActive(string runId) => _active.ContainsKey(runId);
    }
}