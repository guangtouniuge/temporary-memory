# Article Images

New tasks default to `imageSource: ai`, generating exactly two scene illustrations after writing.
Existing tasks without the field retain their previous imported-gallery behavior.
Imported mode uses only the current brand's uploaded images and requires two images for new tasks.

Server-only configuration: `ARK_API_KEY` and `ARK_IMAGE_MODEL`.
API: https://ark.cn-beijing.volces.com/api/v3/images/generations
Official reference: https://www.volcengine.com/docs/82379/1541523

The model returns base64; no arbitrary provider image URL is fetched. Images retain AI watermarking.
Generated images have gallery source `ai`, project ownership and a durable slot key.
Two images are included in the existing one-article quota; no new member charge is introduced.
Provider usage is charged to the configured Ark account. Storage uses existing project storage quotas.
The written draft and each image slot are persisted. Completed images are reused on resume.
Uncertain transport results stop instead of automatically resubmitting a potentially paid request.
Operators must investigate uncertain results before authorizing a new image request.

Tests must use isolated fixtures and mocked image providers, never customer projects.
