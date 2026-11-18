from django.db import models as m
from django.db import transaction
from django.conf import settings


class Tag(m.Model):
    name = m.CharField(max_length=80)


class Profile(m.Model):
    display_name = m.CharField(max_length=80)


class Ledger(m.Model):
    """Ledger entries preserve their original author."""
    owner = m.ForeignKey(settings.AUTH_USER_MODEL, on_delete=m.CASCADE)
    parent = m.ForeignKey("self", null=True, on_delete=m.SET_NULL)
    tags = m.ManyToManyField("Tag")
    profile = m.OneToOneField("Profile", on_delete=m.CASCADE)

    class Meta:
        permissions = [("approve_ledger", "Can approve ledger")]

    @transaction.atomic
    def save(self, *args, **kwargs):
        """Persist an entry atomically."""
        return super().save(*args, **kwargs)

    async def refresh_entry(self):
        return self.save()
