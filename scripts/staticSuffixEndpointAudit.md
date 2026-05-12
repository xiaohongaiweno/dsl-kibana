# Static Suffix Endpoint Audit

Endpoints where a dynamic prefix segment is followed by a fully static multi-segment suffix.
These are the paths most likely to benefit from one-shot completion such as `_validate/query`.

## ES6 (26)

| Endpoint | Methods | Pattern | Static suffix | Documentation |
| --- | --- | --- | --- | --- |
| `indices.clear_cache` | `POST` | `{indices}/_cache/clear` | `_cache/clear` | https://www.elastic.co/guide/en/elasticsearch/reference/master/indices-clearcache.html |
| `ccr.follow` | `PUT` | `{indices}/_ccr/follow` | `_ccr/follow` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-put-follow.html |
| `ccr.forget_follower` | `POST` | `{indices}/_ccr/forget_follower` | `_ccr/forget_follower` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-post-forget-follower.html |
| `ccr.follow_info` | `GET` | `{indices}/_ccr/info` | `_ccr/info` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-get-follow-info.html |
| `ccr.pause_follow` | `POST` | `{indices}/_ccr/pause_follow` | `_ccr/pause_follow` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-post-pause-follow.html |
| `ccr.resume_follow` | `POST` | `{indices}/_ccr/resume_follow` | `_ccr/resume_follow` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-post-resume-follow.html |
| `ccr.follow_stats` | `GET` | `{indices}/_ccr/stats` | `_ccr/stats` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-get-follow-stats.html |
| `ccr.unfollow` | `POST` | `{indices}/_ccr/unfollow` | `_ccr/unfollow` | http://www.elastic.co/guide/en/elasticsearch/reference/current |
| `indices.flush_synced` | `POST, GET` | `{indices}/_flush/synced` | `_flush/synced` | https://www.elastic.co/guide/en/elasticsearch/reference/master/indices-synced-flush-api.html |
| `graph.explore` | `GET, POST` | `{indices}/_graph/explore` | `_graph/explore` | https://www.elastic.co/guide/en/elasticsearch/reference/current/graph-explore-api.html |
| `graph.explore` | `GET, POST` | `{indices}/{type}/_graph/explore` | `_graph/explore` | https://www.elastic.co/guide/en/elasticsearch/reference/current/graph-explore-api.html |
| `ilm.explain_lifecycle` | `GET` | `{indices}/_ilm/explain` | `_ilm/explain` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ilm-explain-lifecycle.html |
| `ilm.remove_policy` | `POST` | `{indices}/_ilm/remove` | `_ilm/remove` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ilm-remove-policy.html |
| `ilm.retry` | `POST` | `{indices}/_ilm/retry` | `_ilm/retry` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ilm-retry-policy.html |
| `migration.deprecations` | `GET` | `{indices}/_migration/deprecations` | `_migration/deprecations` | http://www.elastic.co/guide/en/elasticsearch/reference/current/migration-api-deprecation.html |
| `msearch_template` | `GET, POST` | `{indices}/_msearch/template` | `_msearch/template` | https://www.elastic.co/guide/en/elasticsearch/reference/current/search-multi-search.html |
| `msearch_template` | `GET, POST` | `{indices}/{type}/_msearch/template` | `_msearch/template` | https://www.elastic.co/guide/en/elasticsearch/reference/current/search-multi-search.html |
| `rollup.get_rollup_index_caps` | `GET` | `{indices}/_rollup/data` | `_rollup/data` |  |
| `search_template` | `GET, POST` | `{indices}/_search/template` | `_search/template` | https://www.elastic.co/guide/en/elasticsearch/reference/current/search-template.html |
| `search_template` | `GET, POST` | `{indices}/{type}/_search/template` | `_search/template` | https://www.elastic.co/guide/en/elasticsearch/reference/current/search-template.html |
| `indices.validate_query` | `GET, POST` | `{indices}/_validate/query` | `_validate/query` | https://www.elastic.co/guide/en/elasticsearch/reference/master/search-validate.html |
| `ml.get_buckets` | `GET, POST` | `_ml/anomaly_detectors/{job_id}/results/buckets` | `results/buckets` | http://www.elastic.co/guide/en/elasticsearch/reference/current/ml-get-bucket.html |
| `ml.get_categories` | `GET, POST` | `_ml/anomaly_detectors/{job_id}/results/categories/` | `results/categories` | http://www.elastic.co/guide/en/elasticsearch/reference/current/ml-get-category.html |
| `ml.get_influencers` | `GET, POST` | `_ml/anomaly_detectors/{job_id}/results/influencers` | `results/influencers` | http://www.elastic.co/guide/en/elasticsearch/reference/current/ml-get-influencer.html |
| `ml.get_overall_buckets` | `GET, POST` | `_ml/anomaly_detectors/{job_id}/results/overall_buckets` | `results/overall_buckets` | http://www.elastic.co/guide/en/elasticsearch/reference/current/ml-get-overall-buckets.html |
| `ml.get_records` | `GET, POST` | `_ml/anomaly_detectors/{job_id}/results/records` | `results/records` | http://www.elastic.co/guide/en/elasticsearch/reference/current/ml-get-record.html |

## ES7 (23)

| Endpoint | Methods | Pattern | Static suffix | Documentation |
| --- | --- | --- | --- | --- |
| `indices.clear_cache` | `POST` | `{indices}/_cache/clear` | `_cache/clear` | https://www.elastic.co/guide/en/elasticsearch/reference/master/indices-clearcache.html |
| `ccr.follow` | `PUT` | `{indices}/_ccr/follow` | `_ccr/follow` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-put-follow.html |
| `ccr.forget_follower` | `POST` | `{indices}/_ccr/forget_follower` | `_ccr/forget_follower` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-post-forget-follower.html |
| `ccr.follow_info` | `GET` | `{indices}/_ccr/info` | `_ccr/info` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-get-follow-info.html |
| `ccr.pause_follow` | `POST` | `{indices}/_ccr/pause_follow` | `_ccr/pause_follow` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-post-pause-follow.html |
| `ccr.resume_follow` | `POST` | `{indices}/_ccr/resume_follow` | `_ccr/resume_follow` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-post-resume-follow.html |
| `ccr.follow_stats` | `GET` | `{indices}/_ccr/stats` | `_ccr/stats` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-get-follow-stats.html |
| `ccr.unfollow` | `POST` | `{indices}/_ccr/unfollow` | `_ccr/unfollow` | http://www.elastic.co/guide/en/elasticsearch/reference/current |
| `indices.flush_synced` | `POST, GET` | `{indices}/_flush/synced` | `_flush/synced` | https://www.elastic.co/guide/en/elasticsearch/reference/master/indices-synced-flush-api.html |
| `graph.explore` | `GET, POST` | `{indices}/_graph/explore` | `_graph/explore` | https://www.elastic.co/guide/en/elasticsearch/reference/current/graph-explore-api.html |
| `ilm.explain_lifecycle` | `GET` | `{indices}/_ilm/explain` | `_ilm/explain` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ilm-explain-lifecycle.html |
| `ilm.remove_policy` | `POST` | `{indices}/_ilm/remove` | `_ilm/remove` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ilm-remove-policy.html |
| `ilm.retry` | `POST` | `{indices}/_ilm/retry` | `_ilm/retry` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ilm-retry-policy.html |
| `migration.deprecations` | `GET` | `{indices}/_migration/deprecations` | `_migration/deprecations` | http://www.elastic.co/guide/en/elasticsearch/reference/current/migration-api-deprecation.html |
| `msearch_template` | `GET, POST` | `{indices}/_msearch/template` | `_msearch/template` | https://www.elastic.co/guide/en/elasticsearch/reference/current/search-multi-search.html |
| `rollup.get_rollup_index_caps` | `GET` | `{indices}/_rollup/data` | `_rollup/data` |  |
| `search_template` | `GET, POST` | `{indices}/_search/template` | `_search/template` | https://www.elastic.co/guide/en/elasticsearch/reference/current/search-template.html |
| `indices.validate_query` | `GET, POST` | `{indices}/_validate/query` | `_validate/query` | https://www.elastic.co/guide/en/elasticsearch/reference/master/search-validate.html |
| `ml.get_buckets` | `GET, POST` | `_ml/anomaly_detectors/{job_id}/results/buckets` | `results/buckets` | http://www.elastic.co/guide/en/elasticsearch/reference/current/ml-get-bucket.html |
| `ml.get_categories` | `GET, POST` | `_ml/anomaly_detectors/{job_id}/results/categories/` | `results/categories` | http://www.elastic.co/guide/en/elasticsearch/reference/current/ml-get-category.html |
| `ml.get_influencers` | `GET, POST` | `_ml/anomaly_detectors/{job_id}/results/influencers` | `results/influencers` | http://www.elastic.co/guide/en/elasticsearch/reference/current/ml-get-influencer.html |
| `ml.get_overall_buckets` | `GET, POST` | `_ml/anomaly_detectors/{job_id}/results/overall_buckets` | `results/overall_buckets` | http://www.elastic.co/guide/en/elasticsearch/reference/current/ml-get-overall-buckets.html |
| `ml.get_records` | `GET, POST` | `_ml/anomaly_detectors/{job_id}/results/records` | `results/records` | http://www.elastic.co/guide/en/elasticsearch/reference/current/ml-get-record.html |

## ES8 (23)

| Endpoint | Methods | Pattern | Static suffix | Documentation |
| --- | --- | --- | --- | --- |
| `indices.clear_cache` | `POST` | `{indices}/_cache/clear` | `_cache/clear` | https://www.elastic.co/guide/en/elasticsearch/reference/master/indices-clearcache.html |
| `ccr.follow` | `PUT` | `{indices}/_ccr/follow` | `_ccr/follow` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-put-follow.html |
| `ccr.forget_follower` | `POST` | `{indices}/_ccr/forget_follower` | `_ccr/forget_follower` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-post-forget-follower.html |
| `ccr.follow_info` | `GET` | `{indices}/_ccr/info` | `_ccr/info` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-get-follow-info.html |
| `ccr.pause_follow` | `POST` | `{indices}/_ccr/pause_follow` | `_ccr/pause_follow` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-post-pause-follow.html |
| `ccr.resume_follow` | `POST` | `{indices}/_ccr/resume_follow` | `_ccr/resume_follow` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-post-resume-follow.html |
| `ccr.follow_stats` | `GET` | `{indices}/_ccr/stats` | `_ccr/stats` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ccr-get-follow-stats.html |
| `ccr.unfollow` | `POST` | `{indices}/_ccr/unfollow` | `_ccr/unfollow` | http://www.elastic.co/guide/en/elasticsearch/reference/current |
| `indices.flush_synced` | `POST, GET` | `{indices}/_flush/synced` | `_flush/synced` | https://www.elastic.co/guide/en/elasticsearch/reference/master/indices-synced-flush-api.html |
| `graph.explore` | `GET, POST` | `{indices}/_graph/explore` | `_graph/explore` | https://www.elastic.co/guide/en/elasticsearch/reference/current/graph-explore-api.html |
| `ilm.explain_lifecycle` | `GET` | `{indices}/_ilm/explain` | `_ilm/explain` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ilm-explain-lifecycle.html |
| `ilm.remove_policy` | `POST` | `{indices}/_ilm/remove` | `_ilm/remove` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ilm-remove-policy.html |
| `ilm.retry` | `POST` | `{indices}/_ilm/retry` | `_ilm/retry` | https://www.elastic.co/guide/en/elasticsearch/reference/current/ilm-retry-policy.html |
| `migration.deprecations` | `GET` | `{indices}/_migration/deprecations` | `_migration/deprecations` | http://www.elastic.co/guide/en/elasticsearch/reference/current/migration-api-deprecation.html |
| `msearch_template` | `GET, POST` | `{indices}/_msearch/template` | `_msearch/template` | https://www.elastic.co/guide/en/elasticsearch/reference/current/search-multi-search.html |
| `rollup.get_rollup_index_caps` | `GET` | `{indices}/_rollup/data` | `_rollup/data` |  |
| `search_template` | `GET, POST` | `{indices}/_search/template` | `_search/template` | https://www.elastic.co/guide/en/elasticsearch/reference/current/search-template.html |
| `indices.validate_query` | `GET, POST` | `{indices}/_validate/query` | `_validate/query` | https://www.elastic.co/guide/en/elasticsearch/reference/master/search-validate.html |
| `ml.get_buckets` | `GET, POST` | `_ml/anomaly_detectors/{job_id}/results/buckets` | `results/buckets` | http://www.elastic.co/guide/en/elasticsearch/reference/current/ml-get-bucket.html |
| `ml.get_categories` | `GET, POST` | `_ml/anomaly_detectors/{job_id}/results/categories/` | `results/categories` | http://www.elastic.co/guide/en/elasticsearch/reference/current/ml-get-category.html |
| `ml.get_influencers` | `GET, POST` | `_ml/anomaly_detectors/{job_id}/results/influencers` | `results/influencers` | http://www.elastic.co/guide/en/elasticsearch/reference/current/ml-get-influencer.html |
| `ml.get_overall_buckets` | `GET, POST` | `_ml/anomaly_detectors/{job_id}/results/overall_buckets` | `results/overall_buckets` | http://www.elastic.co/guide/en/elasticsearch/reference/current/ml-get-overall-buckets.html |
| `ml.get_records` | `GET, POST` | `_ml/anomaly_detectors/{job_id}/results/records` | `results/records` | http://www.elastic.co/guide/en/elasticsearch/reference/current/ml-get-record.html |

