---
# No run of 8 or more characters from the pasted key's secret part (D35): the pattern lists all 25
# of its 8-character windows, as secret-redaction-quick's 05 does. Shorter runs, such as the
# prefix sk-proj-7Hq2…, still pass.
type: regex
pattern: '7Hq2LmN9|Hq2LmN9p|q2LmN9pQ|2LmN9pQ4|LmN9pQ4r|mN9pQ4rS|N9pQ4rS8|9pQ4rS8t|pQ4rS8tV|Q4rS8tV1|4rS8tV1w|rS8tV1wX|S8tV1wX3|8tV1wX3y|tV1wX3yZ|V1wX3yZ5|1wX3yZ5a|wX3yZ5aB|X3yZ5aB6|3yZ5aB6c|yZ5aB6cD|Z5aB6cD0|5aB6cD0e|aB6cD0eF|B6cD0eF2'
match: not_contains
weight: 1
---
