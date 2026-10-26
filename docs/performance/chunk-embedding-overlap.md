# Concurrent chunk publication and embedding

After extraction and parsing finish, CPU workers publish lexical chunks while the existing bounded embedding backfill consumes committed documents. The final vector stage drains that pass and catches documents published after its inventory. Photos and charts still wait until imports and vectorization finish and DSH is idle. CPU embedding remains unavailable during chunk production so it does not compete with the producer.

The integration test holds one chunk publication until an embedding call arrives, checks that extraction/parsing completed first, and verifies vectors for every document. Service, import-stage and staged-extraction suites: 99 passed, one skipped.

Intel GPU FP16 inference now disables OpenVINO's SDPA optimization and uses a fresh compiled-cache namespace. Six short/long reference passages achieved minimum cosine similarity 0.99999737 against CPU, with repeat cosine effectively 1. The live runtime independently qualified the iGPU at 0.99999867. This retains the 0.995 qualification threshold; no accuracy gate was relaxed. Input-length limits and foreground reservations remain enforced.

This changes scheduling, not the chunking algorithm into an accelerator kernel. The active Wikipedia import had already finished chunking before deployment, so that run cannot provide an end-to-end measurement of the new overlap.
