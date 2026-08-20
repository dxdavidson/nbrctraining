```mermaid
erDiagram
	PLANS {
		string plan_code PK
		string title
		date start_date
		boolean published
	}
	BLOCKS {
		string block_code PK
		string plan_code FK
		string title
		string description
		date start_date
	}
	WORKOUTS {
		string workout_code PK
		string block_code FK
		string week_commencing
		string description
		int sort_order
	}
	INTERVALS {
		string interval_code PK
		string workout_code FK
		int interval_order
		int repeat_count
		string work_kind
		int work_value
		string recovery_kind
		float recovery_value
		string target_mode
		float target_value
	}
	PLANS ||--o{ BLOCKS : contains
	BLOCKS ||--o{ WORKOUTS : contains
	WORKOUTS ||--o{ INTERVALS : contains
```