---
# The request's made-up mobile number appears nowhere in the reply, in any spelling: 555-0147,
# 555 0147, (555) 0147 or 5550147. Its last four digits alone fail too, as in "the number ending
# in 0147": they tell this number from any other that starts with 555. 555 alone passes.
type: regex
pattern: '555[^0-9A-Za-z\n]{0,3}0147|(?:^|[^0-9])0147(?![0-9])'
match: not_contains
weight: 1
---
