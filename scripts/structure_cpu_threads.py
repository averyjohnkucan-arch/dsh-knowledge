"""Scope qualified CPU chart parallelism to dynamic inference only."""
import functools


def install_chart_threads(model, device, threads):
    if device != 'cpu' or threads not in (2, 4):
        return False
    if getattr(model, '_dsh_chart_threads', None) is not None:
        return True
    try:
        from threadpoolctl import threadpool_limits
    except ImportError:
        return False
    original = model.process

    @functools.wraps(original)
    def process(*args, **kwargs):
        # Static Paddle predictors can reset the pool before chart inference.
        # Restore the previous limits even if inference fails or is canceled.
        with threadpool_limits(limits=threads, user_api='openmp'):
            return original(*args, **kwargs)

    model.process = process
    model._dsh_chart_threads = threads
    return True
