import os
import unittest
from unittest.mock import patch

from agent import IDLE_MODE_WAYLAND, IdleSampler


class WaylandIdleTests(unittest.TestCase):
    def test_input_idle_transition_and_resume_without_window(self):
        read_fd, write_fd = os.pipe()
        stream = os.fdopen(read_fd, 'rb', buffering=0)

        class Process:
            stdout = stream

            def poll(self):
                return None

        sampler = IdleSampler(None, IDLE_MODE_WAYLAND, 120, Process())
        try:
            self.assertEqual(sampler.sample(), 0)
            os.write(write_fd, b'idle\n')
            with patch('agent.time.monotonic', return_value=100):
                self.assertEqual(sampler.sample(), 120)
            with patch('agent.time.monotonic', return_value=125):
                self.assertEqual(sampler.sample(), 145)
            os.write(write_fd, b'active\n')
            self.assertEqual(sampler.sample(), 0)
        finally:
            stream.close()
            os.close(write_fd)


if __name__ == '__main__':
    unittest.main()
