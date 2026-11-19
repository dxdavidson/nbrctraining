```mermaid
erDiagram
	PLANS {
        uuid id PK
		string plan_code
		string title
		date start_date
		boolean published
		string description
	}
	BLOCKS {
		uuid id PK
        uuid plan_id FK
		string block_code 
		string title
		string description
		date start_date
		boolean published
	}
	WORKOUTS {
        uuid id PK
        uuid block_id FK		
		string wk_type
		string workout_code
		date week_commencing
		string description
		int sort_order
		string level
		string ergdata_url
	}
	INTERVALS {
        uuid id PK
        uuid workout_id FK		
		string interval_code
		int interval_order
		int repeat_count
		string work_kind
		int work_value
		int spm
		string recovery_kind
		float recovery_value
		string target_mode
		float target_value
	}
	CONCEPT2_TOKENS {
        uuid id PK
        uuid device_id
        string concept2_user_id
		string concept2_user_name
        string access_token
        string refresh_token
        datetime expires_at
        datetime created_at
        datetime updated_at
	}
	STRAVA_TOKENS {
		uuid device_id PK
		string athlete_id
		string athlete_name
		string access_token
		string refresh_token
		datetime expires_at
		datetime created_at
		datetime updated_at
	}
	STRAVA_UPLOADS {
		string athlete_id PK
		uuid session_id PK
		string status
		string upload_id
		string activity_id
		string error
		datetime created_at
		datetime updated_at
	}
	PLANS ||--o{ BLOCKS : contains
	BLOCKS ||--o{ WORKOUTS : contains
	WORKOUTS ||--o{ INTERVALS : contains
```

`CONCEPT2_TOKENS` is standalone (no FK to the plan/block/workout hierarchy) — `device_id` is a random identifier issued in a browser cookie when an athlete links their Concept2 account, since the app has no separate login system.

`STRAVA_TOKENS` is also device-linked and standalone. `STRAVA_UPLOADS` records upload status per athlete and locally stored session; it does not store session records or FIT files. Its composite key prevents duplicate upload attempts.